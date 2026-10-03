import os
import sqlite3
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException
from fastapi.testclient import TestClient
from google.genai import types, errors
from main import app
from backend.accounts.database import database
from backend.accounts.security import digest
from backend.usage import store
from backend.services import providers, provider_cooldown


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'HYPERSENSE_DATA_DIR': self.temp.name,
            'HYPERSENSE_ADMIN_EMAILS': ' ADMIN@example.com ', 'APP_ORIGIN':'http://testserver',
            'APP_ENV':'development', 'MAIL_MODE':'file', 'GEMINI_API_KEY':'fake-secret', 'GROQ_API_KEY':'fake-groq'})
        self.env.start()
        self.client = TestClient(app)
        provider_cooldown._deadlines.clear()

    def tearDown(self):
        self.client.close(); self.env.stop(); self.temp.cleanup()
        provider_cooldown._deadlines.clear()

    def login(self, email='admin@example.com', verified=1):
        with database() as db:
            db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)', ('u',email,'Admin','unused',verified,int(time.time())))
            db.execute('INSERT INTO logins VALUES (?,?,?)', (digest('session'),'u',int(time.time())+1000))
        self.client.cookies.set('hypersense_session','session')
        self.client.headers['X-HyperSense-Account']='u'

    def test_access_enforced_server_side(self):
        self.assertEqual(self.client.get('/api/admin/usage').status_code,401)
        self.assertEqual(self.client.get('/admin/usage',follow_redirects=False).status_code,303)
        self.login('ordinary@example.com')
        self.assertEqual(self.client.get('/api/admin/usage').status_code,403)
        self.assertEqual(self.client.get('/admin/usage').status_code,403)
        self.assertFalse(self.client.get('/auth/me').json()['is_admin'])
        with patch.dict(os.environ, {'HYPERSENSE_ADMIN_EMAILS':'ordinary@example.com'}):
            self.assertEqual(self.client.get('/api/admin/usage').status_code,200)
        self.assertEqual(self.client.get('/api/admin/usage').status_code,403)

    def test_verified_admin_and_stale_account(self):
        self.login()
        response=self.client.get('/api/admin/usage?days=7')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['cache-control'],'no-store')
        self.assertEqual(response.json()['rows'],[])
        self.assertTrue(self.client.get('/auth/me').json()['is_admin'])
        self.assertEqual(self.client.get('/admin/usage').status_code,200)
        self.assertEqual(self.client.get('/api/admin/usage?days=31').status_code,422)
        self.client.headers['X-HyperSense-Account']='other'
        self.assertEqual(self.client.get('/api/admin/usage').status_code,409)
        with database() as db: db.execute('DELETE FROM logins')
        self.assertEqual(self.client.get('/api/admin/usage').status_code,401)

    def test_unverified_admin_denied(self):
        self.login(verified=0)
        self.assertEqual(self.client.get('/api/admin/usage').status_code,401)

    def test_provider_fallback_and_cooldown_counts(self):
        config=types.GenerateContentConfig(system_instruction='private prompt')
        with patch.object(providers.genai,'Client') as gemini, patch.object(providers,'Groq') as groq:
            gemini.return_value.__enter__.return_value.models.generate_content.side_effect=errors.ClientError(429, {'error':{'message':'private provider message'}})
            groq.return_value.__enter__.return_value.chat.completions.create.return_value=SimpleNamespace(choices=[SimpleNamespace(finish_reason='stop',message=SimpleNamespace(content='private answer'))])
            for _ in range(2):
                with store.request_usage('evaluation'):
                    providers.generate_with_fallback('private transcript',config)
        rows=store.snapshot(1)['rows']
        self.assertEqual(sum(r['count'] for r in rows if r['kind']=='request'),2)
        self.assertEqual(sum(r['count'] for r in rows if r['kind']=='attempt'),3)
        self.assertEqual(sum(r['count'] for r in rows if r['kind']=='attempt' and r['outcome']=='rate_limited'),1)
        self.assertEqual(sum(r['count'] for r in rows if r['kind']=='attempt' and r['fallback']),2)
        self.assertEqual(sum(r['count'] for r in rows if r['kind']=='cooldown'),1)
        with store.connection() as db: contents=repr([tuple(row) for row in db.execute('SELECT * FROM counters')])
        for secret in ('private','fake-secret','fake-groq','admin@example.com'):
            self.assertNotIn(secret,contents)

    def test_route_labels_and_failure(self):
        self.login();self.client.headers['Origin']='http://testserver'
        with patch('backend.services.questions.generate_session_questions',side_effect=HTTPException(502,'invalid output')):
            self.assertEqual(self.client.post('/generate-session-questions',json={'technology':'Python','interview_types':['technical']}).status_code,502)
        rows=store.snapshot(1)['rows']
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['operation'],'session_questions')
        self.assertEqual(rows[0]['outcome'],'error')
        self.assertEqual(store.operation.get(),'other')

    def test_retention_concurrency_and_nonfatal_writes(self):
        with patch.object(store.time,'time',return_value=time.time()-31*86400):
            store.record('attempt','Gemini','success')
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _:store.record('attempt','Groq','success',50),range(20)))
        rows=store.snapshot(30)['rows']
        self.assertEqual(sum(r['count'] for r in rows),20)
        self.assertEqual(sum(r['total_ms'] for r in rows),1000)
        with patch.object(store,'connection',side_effect=sqlite3.OperationalError('locked')):
            with store.request_usage('question'):
                pass  # Failed telemetry must not break the successful operation.
