"""Real authentication + tenant isolation tests, with email delivery captured locally."""
import base64
import os
import re
import tempfile
import time
import unittest
from unittest.mock import patch
from fastapi.testclient import TestClient
from backend.accounts.database import database
from backend.accounts.security import digest, limit
from main import app


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.env=patch.dict(os.environ,{'HYPERSENSE_DATA_DIR':self.temp.name,'APP_ORIGIN':'http://testserver','APP_ENV':'development','MAIL_MODE':'file'})
        self.env.start()
        self.mail=patch('backend.accounts.routes.send_link');self.send=self.mail.start()
        self.client=TestClient(app,headers={'Origin':'http://testserver'})

    def tearDown(self):
        self.client.close();self.mail.stop();self.env.stop();self.temp.cleanup()

    def user(self, client=None, email='test@example.com'):
        client=client or self.client
        response=client.post('/auth/signup',json={'email':email,'name':'Daksh','password':'test-password-1234'})
        self.assertEqual(response.status_code,200,response.text)
        token=self.send.call_args.args[2].split('#token=')[1]
        self.assertEqual(client.post('/auth/verify-email',json={'token':token}).status_code,200)
        response=client.post('/auth/login',json={'email':email,'password':'test-password-1234'})
        self.assertEqual(response.status_code,200,response.text)
        with database() as db: uid=db.execute('SELECT id FROM users WHERE email=?',(email,)).fetchone()[0]
        client.headers['X-HyperSense-Account']=uid
        return uid

    def test_signup_verification_login_logout(self):
        self.assertEqual(self.client.get('/results',follow_redirects=False).status_code,303)
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        uid=self.user()
        self.assertEqual(self.client.get('/auth/me').json()['id'],uid)
        page=self.client.get('/interview')
        self.assertIn('content="'+uid+'"',page.text)
        self.assertEqual(page.headers['cache-control'],'no-store')
        cookie=self.client.cookies.get('hypersense_session')
        with database() as db:
            user=db.execute('SELECT password FROM users WHERE id=?',(uid,)).fetchone()
            self.assertNotIn('test-password',user[0])
            self.assertEqual(db.execute('SELECT token FROM logins').fetchone()[0],digest(cookie))
        login=self.client.post('/auth/login',json={'email':'test@example.com','password':'test-password-1234'})
        self.assertIn('HttpOnly',login.headers['set-cookie']);self.assertIn('SameSite=lax',login.headers['set-cookie'])
        self.assertEqual(self.client.post('/auth/logout').status_code,200)
        self.assertEqual(self.client.get('/auth/me').status_code,401)

    def test_unverified_wrong_password_and_origin(self):
        data={'email':'test@example.com','name':'Test','password':'test-password-1234'}
        self.assertEqual(self.client.post('/auth/signup',json=data,headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.post('/auth/signup',json=data).status_code,200)
        self.assertEqual(self.client.post('/auth/login',json=data).status_code,403)
        self.assertEqual(self.client.post('/auth/login',json={**data,'password':'wrong-password-123'}).status_code,401)
        self.assertEqual(self.client.post('/generate-question',json={'technology':'Python'}).status_code,401)
        self.assertEqual(self.client.post('/detect-face').status_code,401)

    def test_reset_is_single_use_and_revokes_sessions(self):
        self.user()
        self.client.post('/auth/forgot-password',json={'email':'test@example.com'})
        token=self.send.call_args.args[2].split('#token=')[1]
        data={'token':token,'password':'new-password-12345'}
        self.assertEqual(self.client.post('/auth/reset-password',json=data).status_code,200)
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        self.assertEqual(self.client.post('/auth/reset-password',json=data).status_code,400)
        self.assertEqual(self.client.post('/auth/login',json={'email':'test@example.com','password':'test-password-1234'}).status_code,401)
        self.assertEqual(self.client.post('/auth/login',json={'email':'test@example.com','password':data['password']}).status_code,200)

    def test_interview_recordings_are_private_and_roundtrip(self):
        uid=self.user()
        b=TestClient(app,headers={'Origin':'http://testserver'})
        self.user(b,'other@example.com')
        record={'id':'session-1','date':'2026-09-25T10:00:00Z','total':1,'settings':{'technology':'Python','resume_text':'private resume'},'answers':[{'question':'Q','answer':'A','score':0,'recording':{'name':'answer.webm','type':'audio/webm','base64':base64.b64encode(b'audio-bytes').decode()}}]}
        url='/api/account/sessions/session-1'
        self.assertEqual(self.client.put(url,json=record).status_code,200)
        result=self.client.get(url).json()
        self.assertEqual(base64.b64decode(result['answers'][0]['recording']['base64']),b'audio-bytes')
        self.assertNotIn('resume_text',result['settings'])
        self.assertEqual(b.get(url).status_code,404)
        self.assertEqual(b.get('/api/account/sessions').json(),[])
        b.delete(url)
        self.assertEqual(self.client.get(url).status_code,200)
        self.assertEqual(self.client.put(url,json=record,headers={'If-None-Match':'*'}).status_code,409)
        self.assertEqual(self.client.delete(url,headers={'Origin':'https://evil.example'}).status_code,403)
        self.assertEqual(self.client.get(url,headers={'X-HyperSense-Account':'wrong-user'}).status_code,409)
        self.assertEqual(self.client.delete(url).status_code,200)
        self.assertEqual(self.client.get(url).status_code,404)
        b.close()

    def test_expiry_limits_and_oversized_requests(self):
        uid=self.user()
        with database() as db: db.execute('UPDATE logins SET expires=0 WHERE user_id=?',(uid,))
        self.assertEqual(self.client.get('/auth/me').status_code,401)
        limit('test-limit',1,60)
        from fastapi import HTTPException
        with self.assertRaises(HTTPException) as caught: limit('test-limit',1,60)
        self.assertEqual(caught.exception.status_code,429)
        self.assertEqual(self.client.post('/auth/login',content=b'x'*70000,headers={'Content-Type':'application/json'}).status_code,413)

    def test_production_configuration_fails_closed(self):
        with patch.dict(os.environ,{'APP_ENV':'production','APP_ORIGIN':'http://testserver'}):
            with self.assertRaises(RuntimeError):
                with TestClient(app): pass
        with patch.dict(os.environ,{'APP_ENV':'production','APP_ORIGIN':'https://example.com','MAIL_MODE':'file'}):
            with self.assertRaises(RuntimeError):
                with TestClient(app): pass
