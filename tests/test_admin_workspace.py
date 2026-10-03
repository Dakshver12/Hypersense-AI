import os
import tempfile
import time
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from backend.accounts.database import database
from backend.accounts.security import digest, hash_password


class AdminWorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'HYPERSENSE_DATA_DIR':self.temp.name,'APP_ORIGIN':'http://testserver','APP_ENV':'development','MAIL_MODE':'file','HYPERSENSE_ADMIN_EMAILS':'admin@example.com,second@example.com'})
        self.env.start();self.client=TestClient(app,headers={'Origin':'http://testserver','X-HyperSense-Account':'admin'})
        self.client.cookies.set('hypersense_session','admin-session')
        with database() as db:
            for uid,email,verified in [('admin','admin@example.com',1),('second','second@example.com',1),('member','member@example.com',1),('pending','pending@example.com',0)]:
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(uid,email,uid,hash_password('test-password-1234') if uid=='member' else 'unused',verified,int(time.time())))
            db.execute('INSERT INTO logins VALUES (?,?,?)',(digest('admin-session'),'admin',int(time.time())+1000))
            db.execute('INSERT INTO logins VALUES (?,?,?)',(digest('member-session'),'member',int(time.time())+1000))
            db.execute('INSERT INTO interviews VALUES (?,?,?,?)',('member','private-session','private transcript and recording',33))

    def tearDown(self):
        self.client.close();self.env.stop();self.temp.cleanup()

    def change(self,uid,action):
        return self.client.post('/api/admin/users/'+uid+'/access',json={'action':action,'reason':'Account review'})

    def test_suspend_blocks_existing_and_new_login_restore_keeps_data(self):
        member=TestClient(app,headers={'Origin':'http://testserver','X-HyperSense-Account':'member'})
        member.cookies.set('hypersense_session','member-session')
        try:
            self.assertEqual(member.get('/auth/me').status_code,200)
            self.assertEqual(self.change('member','suspend').status_code,200)
            self.assertEqual(member.get('/auth/me').status_code,401)
            self.assertEqual(member.get('/api/account/sessions').status_code,401)
            self.assertEqual(member.post('/auth/login',json={'email':'member@example.com','password':'test-password-1234'}).status_code,403)
            self.assertEqual(self.change('member','suspend').status_code,409)
            self.assertEqual(self.change('member','restore').status_code,200)
            self.assertEqual(member.get('/auth/me').status_code,401)
            self.assertEqual(member.post('/auth/login',json={'email':'member@example.com','password':'test-password-1234'}).status_code,200)
            with database() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM interviews').fetchone()[0],1)
            events=self.client.get('/api/admin/audit').json()['events']
            self.assertEqual([e['action'] for e in events],['restore','suspend'])
            self.assertTrue(all(e['actor_id']=='admin' and e['target_id']=='member' for e in events))
        finally:member.close()

    def test_admin_protection_origin_and_regular_user(self):
        for uid in ['admin','second']:
            self.assertEqual(self.change(uid,'suspend').status_code,403)
        self.assertEqual(self.change('missing','suspend').status_code,404)
        self.assertEqual(self.client.post('/api/admin/users/member/access',headers={'Origin':'http://evil.example'},json={'action':'suspend','reason':'testing'}).status_code,403)
        self.assertEqual(self.client.post('/api/admin/users/member/access',json={'action':'suspend','reason':'   '}).status_code,422)
        self.client.cookies.set('hypersense_session','member-session');self.client.headers['X-HyperSense-Account']='member'
        for route in ['/admin','/admin/users','/admin/audit','/api/admin/users','/api/admin/overview','/api/admin/audit']:
            self.assertEqual(self.client.get(route).status_code,403)
        self.assertEqual(self.change('pending','suspend').status_code,403)

    def test_overview_search_pagination_and_private_content(self):
        data=self.client.get('/api/admin/overview').json()
        self.assertEqual(data['users']['total'],4);self.assertEqual(data['users']['verified'],3)
        self.assertEqual(data['sessions']['saved'],1);self.assertEqual(data['users']['signed_in'],2)
        response=self.client.get('/api/admin/users?q=MEMBER')
        self.assertEqual(response.json()['total'],1);self.assertNotIn('private transcript',response.text)
        self.assertEqual(self.client.get('/api/admin/users?q=%25').json()['total'],0)
        self.assertEqual(self.client.get('/api/admin/users?status=unverified').json()['total'],1)
        self.assertEqual(self.client.get('/api/admin/users?page=2').json()['users'],[])
        self.change('member','suspend')
        self.assertEqual(self.client.get('/api/admin/users?status=suspended').json()['total'],1)
        self.assertEqual(self.client.get('/api/admin/overview').json()['users']['signed_in'],1)
        for path,active in [('/admin','overview'),('/admin/users','users'),('/admin/audit','audit'),('/admin/usage','usage')]:
            response=self.client.get(path)
            self.assertEqual(response.status_code,200)
            self.assertIn('data-page="'+active+'" aria-current="page"',response.text)
            self.assertEqual(response.headers['cache-control'],'no-store')
