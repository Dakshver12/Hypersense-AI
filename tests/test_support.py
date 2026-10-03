import os
import tempfile
import time
import unittest
from uuid import uuid4
from unittest.mock import patch
from fastapi.testclient import TestClient
from main import app
from backend.accounts.database import database
from backend.accounts.security import digest

class SupportTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'HYPERSENSE_DATA_DIR':self.temp.name,'APP_ORIGIN':'http://testserver','APP_ENV':'development','MAIL_MODE':'file','HYPERSENSE_ADMIN_EMAILS':'admin@example.com'})
        self.env.start();self.clients=[]
        with database() as db:
            for uid in ('a','b','admin'):
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',(uid,uid+'@example.com',uid,'unused',1,int(time.time())))
                db.execute('INSERT INTO logins VALUES (?,?,?)',(digest(uid+'token'),uid,int(time.time())+1000))
        self.a=self.client('a');self.b=self.client('b');self.admin=self.client('admin')
        self.report={'request_id':str(uuid4()),'category':'bug','title':'Recording issue','description':'The recording stopped before the time limit.'}

    def client(self,uid):
        c=TestClient(app,headers={'Origin':'http://testserver','X-HyperSense-Account':uid});c.cookies.set('hypersense_session',uid+'token');self.clients.append(c);return c

    def tearDown(self):
        for c in self.clients:c.close()
        self.env.stop();self.temp.cleanup()

    def test_submit_retry_and_owner_isolation(self):
        first=self.a.post('/api/support',json=self.report)
        self.assertEqual(first.status_code,200,first.text);self.assertTrue(first.json()['created'])
        self.assertFalse(self.a.post('/api/support',json=self.report).json()['created'])
        rid=self.report['request_id']
        self.assertEqual(self.a.get('/api/support').json()['total'],1)
        self.assertEqual(self.b.get('/api/support').json()['total'],0)
        self.assertEqual(self.b.get('/api/support/'+rid).status_code,404)
        self.assertEqual(self.b.post('/api/support',json=self.report).status_code,409)
        self.assertEqual(self.a.get('/api/support/'+rid).json()['status'],'open')

    def test_admin_reply_resolution_conflicts_and_audit(self):
        self.a.post('/api/support',json=self.report);rid=self.report['request_id'];url='/api/admin/support/'+rid
        self.assertEqual(self.a.get('/api/admin/support').status_code,403)
        self.assertEqual(self.a.patch(url,json={'status':'resolved','reply':'Fixed','version':1}).status_code,403)
        self.assertEqual(self.admin.patch(url,json={'status':'resolved','reply':' ','version':1}).status_code,422)
        self.assertEqual(self.admin.patch(url,json={'status':'in_progress','reply':'Investigating the timer.','version':1}).status_code,200)
        self.assertEqual(self.admin.patch(url,json={'status':'resolved','reply':'Fixed','version':1}).status_code,409)
        self.assertEqual(self.admin.patch(url,json={'status':'resolved','reply':'The timer fix is available.','version':2}).status_code,200)
        data=self.a.get('/api/support/'+rid).json();self.assertEqual(data['reply'],'The timer fix is available.');self.assertEqual(data['status'],'resolved')
        data=self.admin.get('/api/admin/support?status=resolved&q=Recording').json();self.assertEqual(data['total'],1);self.assertEqual(data['counts']['resolved'],1)
        self.assertEqual(self.admin.get('/api/admin/support?q=%25').json()['total'],0)
        with database() as db:
            events=db.execute('SELECT action,reason FROM admin_audit').fetchall()
        self.assertEqual(len(events),2);self.assertEqual(events[0]['action'],'support_update');self.assertNotIn('Investigating',events[0]['reason'])

    def test_guards_validation_and_deletion(self):
        self.assertEqual(self.a.post('/api/support',json=self.report,headers={'Origin':'http://evil.example'}).status_code,403)
        self.assertEqual(self.a.post('/api/support',json={**self.report,'description':'x'}).status_code,422)
        self.assertEqual(self.a.post('/api/support',json={**self.report,'title':'   '}).status_code,422)
        self.assertEqual(self.a.get('/api/support',headers={'X-HyperSense-Account':'wrong'}).status_code,409)
        self.a.post('/api/support',json=self.report)
        self.assertEqual(self.a.get('/support').status_code,200)
        self.assertEqual(self.a.get('/admin/support').status_code,403)
        page=self.admin.get('/admin/support');self.assertEqual(page.status_code,200);self.assertIn('data-page="support" aria-current="page"',page.text)
        self.assertEqual(page.headers['cache-control'],'no-store')
        with database() as db:db.execute('DELETE FROM users WHERE id=?',('a',))
        self.assertEqual(self.admin.get('/api/admin/support').json()['total'],0)
        self.assertEqual(self.a.get('/api/support').status_code,401)

    def test_rate_limit(self):
        for _ in range(10):
            response=self.a.post('/api/support',json={**self.report,'request_id':str(uuid4())})
            self.assertEqual(response.status_code,200)
        self.assertEqual(self.a.post('/api/support',json={**self.report,'request_id':str(uuid4())}).status_code,429)

    def test_unread_replies_and_concurrent_reads(self):
        self.a.post('/api/support',json=self.report)
        rid=self.report['request_id'];url='/api/admin/support/'+rid;read='/api/support/'+rid+'/read'
        count=lambda c:c.get('/api/support/unread').json()['unread']
        self.assertEqual(count(self.a),0)
        self.assertEqual(self.admin.get('/api/admin/support').json()['awaiting_reply'],1)
        self.admin.patch(url,json={'status':'in_progress','reply':'Investigating','version':1})
        self.assertEqual(count(self.a),1);self.assertEqual(count(self.b),0)
        self.assertEqual(self.admin.get('/api/admin/support').json()['awaiting_reply'],0)
        detail=self.a.get('/api/support/'+rid).json();self.assertEqual(count(self.a),1)
        self.admin.patch(url,json={'status':'in_progress','reply':'Update available','version':2})
        self.assertEqual(self.b.post(read,json={'reply_version':3}).status_code,404)
        self.assertEqual(self.a.post(read,json={'reply_version':3},headers={'Origin':'http://evil.example'}).status_code,403)
        self.a.post(read,json={'reply_version':detail['reply_version']});self.assertEqual(count(self.a),1)
        self.a.post(read,json={'reply_version':3});self.assertEqual(count(self.client('a')),0)
        self.admin.patch(url,json={'status':'resolved','reply':'Update available','version':3});self.assertEqual(count(self.a),0)
        self.admin.patch(url,json={'status':'resolved','reply':'Another fix','version':4});self.assertEqual(count(self.a),1)
        self.a.post(read,json={'reply_version':999})
        self.admin.patch(url,json={'status':'resolved','reply':'New reply','version':5});self.assertEqual(count(self.a),1)

    def test_thread_history_reopen_retry_and_admin_reads(self):
        self.a.post('/api/support',json=self.report);rid=self.report['request_id']
        user_url='/api/support/'+rid;admin_url='/api/admin/support/'+rid
        self.assertTrue(self.admin.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        self.admin.post(admin_url+'/read',json={'reply_version':1})
        self.assertFalse(self.admin.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        with patch.dict(os.environ,{'HYPERSENSE_ADMIN_EMAILS':'admin@example.com,b@example.com'}):
            self.assertTrue(self.b.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        reply={'request_id':str(uuid4()),'body':'Please try the latest fix.','version':1,'status':'resolved'}
        self.assertEqual(self.admin.post(admin_url+'/messages',json=reply).status_code,200)
        self.assertEqual(self.admin.post(admin_url+'/messages',json=reply).status_code,200)
        self.assertEqual(len(self.a.get(user_url).json()['messages']),1)
        message={'request_id':str(uuid4()),'body':'It still stops on the last question.','version':2,'reopen':True}
        self.assertEqual(self.b.post(user_url+'/messages',json=message).status_code,404)
        self.assertEqual(self.a.post(user_url+'/messages',json={**message,'status':'resolved'}).status_code,422)
        self.assertEqual(self.a.post(user_url+'/messages',json={**message,'reopen':False}).status_code,409)
        self.assertEqual(self.a.post(user_url+'/messages',json=message,headers={'Origin':'http://evil.example'}).status_code,403)
        self.assertEqual(self.a.post(user_url+'/messages',json=message).status_code,200)
        self.assertEqual(self.a.post(user_url+'/messages',json=message).status_code,200)
        detail=self.a.get(user_url).json()
        self.assertEqual(detail['status'],'open');self.assertEqual([m['role'] for m in detail['messages']],['admin','user'])
        self.assertEqual(detail['messages'][0]['body'],reply['body'])
        self.assertEqual(self.admin.get('/api/admin/support').json()['awaiting_reply'],1)
        self.assertTrue(self.admin.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        self.admin.post(admin_url+'/read',json={'reply_version':1})
        self.assertTrue(self.admin.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        self.admin.post(admin_url+'/read',json={'reply_version':3})
        self.assertFalse(self.admin.get('/api/admin/support').json()['reports'][0]['admin_unread'])
        self.assertEqual(self.admin.get('/api/admin/support').json()['awaiting_reply'],1)
        self.assertEqual(self.a.post(user_url+'/messages',json={**message,'request_id':str(uuid4())}).status_code,409)
        self.assertEqual(self.admin.post(admin_url+'/messages',json={**reply,'request_id':str(uuid4()),'version':3}).status_code,200)
        self.assertEqual(len(self.a.get(user_url).json()['messages']),3)
        self.assertEqual(self.admin.get('/api/admin/support').json()['awaiting_reply'],0)
        with database() as db: db.execute('DELETE FROM users WHERE id=?',('a',))
        with database() as db:
            for table in ('support_messages','support_threads','support_admin_reads'):
                self.assertEqual(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)

    def test_legacy_reply_migration_preserves_receipts_once(self):
        self.a.post('/api/support',json=self.report);rid=self.report['request_id']
        with database() as db:
            db.execute('DELETE FROM support_threads WHERE report_id=?',(rid,))
            db.execute("UPDATE support_reports SET reply='Original reply',version=2 WHERE id=?",(rid,))
            db.execute('UPDATE support_receipts SET reply_version=2,read_version=2 WHERE report_id=?',(rid,))
        for _ in range(2):
            data=self.a.get('/api/support/'+rid).json()
            self.assertEqual(len(data['messages']),1)
            self.assertEqual(data['messages'][0]['body'],'Original reply')
            self.assertFalse(data['unread'])
