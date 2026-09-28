"""Settings must preserve tenant boundaries and revoke old credentials."""
import unittest
from fastapi.testclient import TestClient
import test_accounts
from backend.accounts.database import database
from main import app


class SettingsTests(unittest.TestCase):
    setUp = test_accounts.AccountTests.setUp
    tearDown = test_accounts.AccountTests.tearDown
    user = test_accounts.AccountTests.user

    def test_profile_and_request_guards(self):
        self.assertEqual(self.client.get('/account',follow_redirects=False).status_code,303)
        uid=self.user()
        page=self.client.get('/account')
        self.assertEqual(page.status_code,200)
        self.assertEqual(page.headers['cache-control'],'no-store')
        self.assertIn(uid,page.text)
        url='/api/account/profile'
        self.assertEqual(self.client.patch(url,json={'name':'  '}).status_code,422)
        self.assertEqual(self.client.patch(url,json={'name':'New'},headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.patch(url,json={'name':'New'},headers={'X-HyperSense-Account':'other'}).status_code,409)
        self.assertEqual(self.client.patch(url,json={'name':'  New name  '}).status_code,200)
        self.assertEqual(self.client.get('/auth/me').json()['name'],'New name')

    def second_login(self):
        client=TestClient(app,headers=dict(self.client.headers))
        self.assertEqual(client.post('/auth/login',json={'email':'test@example.com','password':'test-password-1234'}).status_code,200)
        self.addCleanup(client.close)
        return client

    def test_password_revokes_all_logins_and_links(self):
        uid=self.user();other=self.second_login()
        with database() as db: db.execute('INSERT INTO links VALUES (?,?,?,?)',('token',uid,'reset',9999999999))
        url='/api/account/password';data={'current_password':'wrong','password':'new-password-12345'}
        self.assertEqual(self.client.post(url,json=data).status_code,400)
        self.assertEqual(other.get('/auth/me').status_code,200)
        data['current_password']='test-password-1234'
        self.assertEqual(self.client.post(url,json=data).status_code,200)
        self.assertEqual(other.get('/auth/me').status_code,401)
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        with database() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM links WHERE user_id=?',(uid,)).fetchone()[0],0)
        self.assertEqual(self.client.post('/auth/login',json={'email':'test@example.com','password':'test-password-1234'}).status_code,401)
        self.assertEqual(self.client.post('/auth/login',json={'email':'test@example.com','password':data['password']}).status_code,200)

    def test_logout_all(self):
        self.user();other=self.second_login()
        self.assertEqual(self.client.post('/api/account/logout-all').status_code,200)
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        self.assertEqual(other.get('/auth/me').status_code,401)

    def test_delete_only_own_account(self):
        uid=self.user()
        other=TestClient(app,headers={'Origin':'http://testserver'});self.addCleanup(other.close)
        oid=self.user(other,'other@example.com')
        with database() as db:
            for user_id in (uid,oid):
                db.execute('INSERT INTO interviews VALUES (?,?,?,?)',(user_id,'saved','{}',2))
                db.execute('INSERT INTO links VALUES (?,?,?,?)',(user_id,user_id,'reset',9999999999))
        data={'current_password':'test-password-1234','confirmation':'no'}
        self.assertEqual(self.client.request('DELETE','/api/account',json=data).status_code,400)
        data.update(confirmation='DELETE',current_password='wrong')
        self.assertEqual(self.client.request('DELETE','/api/account',json=data).status_code,400)
        data['current_password']='test-password-1234'
        self.assertEqual(self.client.request('DELETE','/api/account',json=data).status_code,200)
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        self.assertEqual(other.get('/auth/me').status_code,200)
        with database() as db:
            self.assertIsNone(db.execute('SELECT * FROM users WHERE id=?',(uid,)).fetchone())
            for table in ('interviews','links','logins'):
                self.assertEqual(db.execute('SELECT COUNT(*) FROM '+table+' WHERE user_id=?',(uid,)).fetchone()[0],0)
                self.assertGreater(db.execute('SELECT COUNT(*) FROM '+table+' WHERE user_id=?',(oid,)).fetchone()[0],0)
