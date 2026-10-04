"""Real app/database tests; only Supabase HTTP responses are simulated."""
import os
import tempfile
import time
import unittest
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from fastapi.testclient import TestClient
from backend.accounts.database import database
from backend.accounts.security import digest, hash_password
from backend.accounts.object_storage import ObjectStorage, MAX_RECORDING_BYTES
from backend.accounts.recordings import cleanup
from main import app


class RecordingStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'DATABASE_URL':'', 'HYPERSENSE_DATA_DIR':self.temp.name,
            'APP_ORIGIN':'http://testserver', 'APP_ENV':'development', 'MAIL_MODE':'file',
            'SUPABASE_URL':'https://storage-test.supabase.co', 'SUPABASE_SECRET_KEY':'sb_secret_test-only',
            'SUPABASE_STORAGE_BUCKET':'interview-recordings'})
        self.env.start()
        with database() as db:
            for uid in ('alice','bob'):
                db.execute('INSERT INTO users VALUES (?,?,?,?,?,?)',
                           (uid,uid+'@example.com',uid,hash_password('test-password-1234'),1,1))
                db.execute('INSERT INTO logins VALUES (?,?,?)', (digest(uid+'-token'),uid,int(time.time())+3600))
        self.client = TestClient(app, headers={'Origin':'http://testserver','X-HyperSense-Account':'alice'})
        self.client.cookies.set('hypersense_session','alice-token')
        self.other = TestClient(app, headers={'Origin':'http://testserver','X-HyperSense-Account':'bob'})
        self.other.cookies.set('hypersense_session','bob-token')
        self.remote_calls = []
        self.size = 10
        self.mime = 'audio/webm'
        self.fail_delete = False
        self.remote = patch.object(ObjectStorage,'request',side_effect=self.provider)
        self.remote.start()

    def tearDown(self):
        self.remote.stop(); self.client.close(); self.other.close(); self.env.stop(); self.temp.cleanup()

    def provider(self, method, path, body=None):
        self.remote_calls.append((method,path,body))
        if path.startswith('/bucket/'):
            return {'public':False,'file_size_limit':MAX_RECORDING_BYTES}
        if method=='POST' and path.startswith('/object/upload/sign/'):
            return {'url':path+'?token=upload-test'}
        if path.startswith('/object/info/'):
            return {'size':self.size,'content_type':self.mime}
        if method=='POST' and path.startswith('/object/sign/'):
            return {'signedURL':path+'?token=playback-test'}
        if method=='DELETE':
            if self.fail_delete: raise HTTPException(503,'Simulated outage')
            return []
        raise AssertionError((method,path,body))

    def upload(self, session='one', complete=True):
        r=self.client.post('/api/account/recordings/uploads',json={
            'session_id':session,'name':'answer.webm','type':'audio/webm;codecs=opus','bytes':10})
        self.assertEqual(r.status_code,200,r.text)
        self.assertNotIn('sb_secret',r.text)
        self.assertIn('/alice/'+session+'/',r.json()['upload_url'])
        ident=r.json()['object_id']
        if complete:
            r=self.client.post('/api/account/recordings/'+ident+'/complete')
            self.assertEqual(r.status_code,200,r.text)
        return ident

    def document(self, ident, session='one'):
        return {'id':session,'date':'2026-10-03','total':1,'settings':{'technology':'Python'},
                'answers':[{'question':'Q','answer':'A','recording':{'object_id':ident,'bytes':999,'name':'spoof'}}]}

    def save(self, ident):
        r=self.client.put('/api/account/sessions/one',json=self.document(ident))
        self.assertEqual(r.status_code,200,r.text)

    def test_upload_save_reopen_and_private_playback(self):
        self.assertTrue(self.client.get('/api/account/recordings/config').json()['enabled'])
        ident=self.upload(); self.save(ident)
        rec=self.client.get('/api/account/sessions/one').json()['answers'][0]['recording']
        self.assertEqual(rec,{'object_id':ident,'name':'answer.webm','type':'audio/webm','bytes':10})
        self.assertNotIn('base64',self.client.get('/api/account/sessions').text)
        self.assertEqual(self.other.get('/api/account/recordings/'+ident+'/playback').status_code,404)
        self.assertEqual(self.other.post('/api/account/recordings/'+ident+'/complete').status_code,404)
        self.assertEqual(self.other.put('/api/account/sessions/one',json=self.document(ident)).status_code,404)
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,200)
        self.assertIn(('POST','/object/sign/interview-recordings/alice/one/'+ident,{'expiresIn':300}),self.remote_calls)
        self.client.cookies.clear()
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,401)

    def test_wrong_session_pending_and_bad_origin_rejected(self):
        ident=self.upload(complete=False)
        self.assertEqual(self.client.put('/api/account/sessions/one',json=self.document(ident)).status_code,422)
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,409)
        self.client.post('/api/account/recordings/'+ident+'/complete')
        self.assertEqual(self.client.put('/api/account/sessions/two',json=self.document(ident,'two')).status_code,422)
        self.assertEqual(self.client.post('/api/account/recordings/'+ident+'/complete',headers={'Origin':'https://other.example'}).status_code,403)

    def test_complete_checks_size_and_type_and_is_idempotent(self):
        ident=self.upload(complete=False); self.size=11
        self.assertEqual(self.client.post('/api/account/recordings/'+ident+'/complete').status_code,422)
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,404)
        self.size=10; ident=self.upload(complete=False); self.mime='audio/mpeg'
        self.assertEqual(self.client.post('/api/account/recordings/'+ident+'/complete').status_code,422)
        self.mime='audio/webm'; ident=self.upload()
        count=len(self.remote_calls)
        self.assertEqual(self.client.post('/api/account/recordings/'+ident+'/complete').status_code,200)
        self.assertEqual(len(self.remote_calls),count)

    def test_delete_revokes_access_and_retries_after_outage(self):
        ident=self.upload(); self.save(ident); self.fail_delete=True
        self.assertEqual(self.client.delete('/api/account/sessions/one').status_code,200)
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,404)
        self.assertEqual(cleanup()['failed'],1)
        self.fail_delete=False
        self.assertEqual(cleanup()['deferred'],1)
        with database() as db: db.execute('UPDATE recording_objects SET expires=0')
        self.assertEqual(cleanup()['deleted'],1)
        with database() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM recording_objects').fetchone()[0],0)

    def test_cleanup_keeps_referenced_objects_and_collects_abandoned(self):
        ident=self.upload(); self.save(ident); abandoned=self.upload('two')
        with database() as db: db.execute('UPDATE recording_objects SET created=0,expires=0')
        self.assertEqual(cleanup()['deleted'],1)
        self.assertEqual(self.client.get('/api/account/recordings/'+ident+'/playback').status_code,200)
        self.assertEqual(self.client.get('/api/account/recordings/'+abandoned+'/playback').status_code,404)

    def test_account_delete_leaves_retry_receipt(self):
        ident=self.upload(); self.save(ident); self.fail_delete=True
        r=self.client.request('DELETE','/api/account',json={'current_password':'test-password-1234','confirmation':'DELETE'})
        self.assertEqual(r.status_code,200,r.text)
        with database() as db:
            self.assertIsNone(db.execute('SELECT id FROM users WHERE id=?',('alice',)).fetchone())
            self.assertEqual(db.execute('SELECT status FROM recording_objects WHERE id=?',(ident,)).fetchone()[0],'deleting')

    def test_capacity_is_reserved_even_for_tiny_pending_uploads(self):
        for _ in range(10): self.upload(complete=False)
        r=self.client.post('/api/account/recordings/uploads',json={'session_id':'one','bytes':1})
        self.assertEqual(r.status_code,413,r.text)

    def test_verified_immutable_objects_count_actual_bytes(self):
        for _ in range(11): self.upload()
        from backend.accounts.recordings import storage_usage
        with database() as db: self.assertEqual(storage_usage(db,'alice'),110)

    def test_config_disabled_partial_and_public_bucket(self):
        with patch.dict(os.environ,{'SUPABASE_URL':'','SUPABASE_SECRET_KEY':'','SUPABASE_STORAGE_BUCKET':''}):
            self.assertEqual(self.client.get('/api/account/recordings/config').json(),{'enabled':False})
        with patch.dict(os.environ,{'SUPABASE_SECRET_KEY':''}):
            self.assertEqual(self.client.get('/api/account/recordings/config').status_code,503)
        with patch.object(ObjectStorage,'request',return_value={'public':True,'file_size_limit':1024}):
            self.assertEqual(self.client.get('/api/account/recordings/config').status_code,503)

    def test_provider_links_and_configuration_cannot_redirect_secrets(self):
        storage=ObjectStorage()
        self.assertNotIn('Authorization',storage.headers)
        with self.assertRaises(HTTPException):storage.signed_url('https://evil.example/?token=x','/object/sign/')
        with patch.dict(os.environ,{'SUPABASE_URL':'https://storage-test.supabase.co/path'}):
            with self.assertRaises(HTTPException):ObjectStorage()


class StorageTransportTests(unittest.TestCase):
    def test_info_accepts_metadata_and_rejects_missing_type(self):
        with patch.dict(os.environ,{'SUPABASE_URL':'https://storage-test.supabase.co',
                                  'SUPABASE_SECRET_KEY':'sb_secret_private','SUPABASE_STORAGE_BUCKET':'interview-recordings'}):
            with patch.object(ObjectStorage,'request',return_value={'metadata':{'size':10,'mimetype':'audio/webm'}}):
                self.assertEqual(ObjectStorage().info('owned/key'),(10,'audio/webm'))
            with patch.object(ObjectStorage,'request',return_value={'size':10}):
                with self.assertRaises(HTTPException):ObjectStorage().info('owned/key')

    def test_secret_stays_on_server_and_remote_errors_are_redacted(self):
        with patch.dict(os.environ,{'SUPABASE_URL':'https://storage-test.supabase.co',
                                  'SUPABASE_SECRET_KEY':'sb_secret_private','SUPABASE_STORAGE_BUCKET':'interview-recordings'}):
            with patch('backend.accounts.object_storage.httpx.Client') as client:
                client.return_value.__enter__.return_value.request.return_value=httpx.Response(403,json={'error':'private provider details'})
                with self.assertRaises(HTTPException) as caught:ObjectStorage().check_bucket()
                self.assertNotIn('private provider',caught.exception.detail)
                kwargs=client.return_value.__enter__.return_value.request.call_args.kwargs
                self.assertEqual(kwargs['headers'],{'apikey':'sb_secret_private'})
