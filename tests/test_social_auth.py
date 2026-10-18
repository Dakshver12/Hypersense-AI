"""Offline OAuth and email tests: isolated SQLite, fake providers, no real mail."""
import os
import tempfile
import time
import unittest
from urllib.parse import parse_qs, urlsplit
from unittest.mock import patch

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
from backend.accounts import oauth, routes
from backend.accounts.database import database
from backend.accounts.mail import send_link
from backend.accounts.security import COOKIE, digest, hash_password


class SocialAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {'DATABASE_URL': '', 'HYPERSENSE_DATA_DIR': self.temp.name,
            'APP_ENV': 'development', 'APP_ORIGIN': 'http://testserver', 'MAIL_MODE': 'file',
            'GOOGLE_CLIENT_ID': 'google-test', 'GOOGLE_CLIENT_SECRET': 'google-secret',
            'GITHUB_CLIENT_ID': 'github-test', 'GITHUB_CLIENT_SECRET': 'github-secret'})
        self.env.start()
        app = FastAPI(); app.include_router(routes.router); app.include_router(oauth.router)
        self.client = TestClient(app, headers={'Origin': 'http://testserver'}, follow_redirects=False)

    def tearDown(self):
        self.client.close(); self.env.stop(); self.temp.cleanup()

    def start(self, provider='google', connect=False):
        r = self.client.get('/auth/oauth/' + provider + '/start' + ('?connect=1' if connect else ''))
        self.assertEqual(r.status_code, 303)
        params = parse_qs(urlsplit(r.headers['location']).query)
        self.assertEqual(params['code_challenge_method'], ['S256'])
        self.assertNotIn('client_secret', params)
        self.assertIn('HttpOnly', r.headers['set-cookie'])
        return params['state'][0]

    def callback(self, state, provider='google'):
        return self.client.get('/auth/oauth/' + provider + '/callback', params={'state': state, 'code': 'test-code'})

    def test_config_and_provider_visibility(self):
        self.assertEqual(self.client.get('/auth/providers').json()['providers'], ['google', 'github'])
        html = self.client.get('/signup').text
        self.assertIn('Continue with Google', html); self.assertIn('Continue with GitHub', html)
        self.assertNotIn('google-secret', html)
        with patch.dict(os.environ, {'GOOGLE_CLIENT_SECRET': ''}):
            self.assertNotIn('Continue with Google', self.client.get('/login').text)
            self.assertIn('not-configured', self.client.get('/auth/oauth/google/start').headers['location'])
        self.assertEqual(self.client.get('/auth/oauth/fake/start').status_code, 404)

    def test_state_cookie_expiry_cancellation_and_replay(self):
        state = self.start()
        with patch.object(oauth, 'provider_identity') as fetch:
            self.assertIn('expired', self.callback('x'*43).headers['location']); fetch.assert_not_called()
        state = self.start()
        with database() as db: db.execute('UPDATE oauth_flows SET expires=0')
        self.assertIn('expired', self.callback(state).headers['location'])
        state = self.start()
        r = self.client.get('/auth/oauth/google/callback', params={'state': state, 'error': 'access_denied'})
        self.assertIn('cancelled', r.headers['location'])
        self.assertIn('expired', self.callback(state).headers['location'])

    def test_create_returning_identity_and_cookie_revocation(self):
        with patch.object(oauth, 'provider_identity', return_value=('google-sub', 'new@example.com', 'Daksh')):
            state = self.start(); r = self.callback(state)
            self.assertEqual(r.headers['location'], '/interview')
            self.assertIn('HttpOnly', r.headers['set-cookie']); self.assertIn('SameSite=lax', r.headers['set-cookie'])
            old = self.client.cookies.get(COOKIE)
            with database() as db:
                uid = db.execute('SELECT id FROM users WHERE email=?', ('new@example.com',)).fetchone()[0]
                self.assertEqual(db.execute('SELECT verified FROM users').fetchone()[0], 1)
            self.assertIn('expired', self.callback(state).headers['location'])
            state = self.start(); self.callback(state)
            with database() as db:
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)
                self.assertIsNone(db.execute('SELECT 1 FROM logins WHERE token=?', (digest(old),)).fetchone())
            self.client.headers['X-HyperSense-Account'] = uid
            self.assertEqual(self.client.post('/auth/logout').status_code, 200)
            with database() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM logins').fetchone()[0], 0)

    def local_user(self):
        with database() as db:
            db.execute('INSERT INTO users VALUES (?,?,?,?,1,?)', ('local-user', 'existing@example.com', 'Daksh', hash_password('test-password-1234'), int(time.time())))

    def test_existing_email_not_implicitly_linked_and_explicit_connection(self):
        self.local_user()
        with patch.object(oauth, 'provider_identity', return_value=('sub-existing', 'existing@example.com', 'Daksh')):
            self.assertIn('existing-account', self.callback(self.start()).headers['location'])
            with database() as db: self.assertEqual(db.execute('SELECT COUNT(*) FROM oauth_identities').fetchone()[0], 0)
            self.assertEqual(self.client.post('/auth/login', json={'email': 'existing@example.com', 'password': 'test-password-1234'}).status_code, 200)
            self.assertEqual(self.callback(self.start(connect=True)).headers['location'], '/account')
            with database() as db:
                self.assertEqual(db.execute('SELECT user_id FROM oauth_identities').fetchone()[0], 'local-user')
                self.assertEqual(db.execute('SELECT COUNT(*) FROM users').fetchone()[0], 1)

    def test_suspended_identity_cannot_sign_in(self):
        self.local_user()
        with database() as db:
            db.execute('INSERT INTO oauth_identities VALUES (?,?,?)', ('google', 'blocked', 'local-user'))
            db.execute('INSERT INTO account_suspensions VALUES (?,?)', ('local-user', int(time.time())))
        with patch.object(oauth, 'provider_identity', return_value=('blocked', 'existing@example.com', 'Daksh')):
            self.assertIn('suspended', self.callback(self.start()).headers['location'])
            self.assertFalse(self.client.cookies.get(COOKIE))

    def test_provider_transport_and_verified_emails(self):
        original_client = httpx.Client
        for provider in ('google', 'github'):
            seen = []
            def handle(request):
                seen.append(request)
                if request.method == 'POST': return httpx.Response(200, json={'access_token': 'secret-token'})
                if request.url.path.endswith('/emails'):
                    return httpx.Response(200, json=[{'email': 'wrong@example.com', 'verified': False, 'primary': True}, {'email': 'valid@example.com', 'verified': True, 'primary': False}])
                return httpx.Response(200, json={'sub': 'google-sub', 'id': 123, 'name': 'Daksh', 'email': 'valid@example.com', 'email_verified': True})
            with patch.object(oauth.httpx, 'Client', side_effect=lambda **kw: original_client(transport=httpx.MockTransport(handle), **kw)):
                result = oauth.provider_identity(provider, 'code', 'test-verifier')
            self.assertEqual(result[1], 'valid@example.com')
            self.assertIn(b'code_verifier=test-verifier', seen[0].content)
            self.assertEqual(seen[1].headers['Authorization'], 'Bearer secret-token')
        def unverified(request):
            return httpx.Response(200, json={'access_token':'t'} if request.method=='POST' else {'sub':'sub','email':'x@example.com','email_verified':False})
        with patch.object(oauth.httpx, 'Client', side_effect=lambda **kw: original_client(transport=httpx.MockTransport(unverified), **kw)):
            with self.assertRaisesRegex(ValueError, 'verified-email'): oauth.provider_identity('google','code','verifier')

    def test_verification_routes_mail_and_one_use(self):
        for path in ('/verify-account', '/verify-email', '/connect-account'):
            r = self.client.get(path); self.assertEqual(r.status_code,200); self.assertIn('verification-link-form',r.text)
        captured = []
        with patch.object(routes, 'send_link', side_effect=lambda email, purpose, url: captured.append(url)):
            r = self.client.post('/auth/signup', json={'name':'Daksh','email':'mail@example.com','password':'test-password-1234'})
            self.assertEqual(r.status_code,200)
        token = captured[0].split('#token=')[1]
        self.assertEqual(self.client.post('/auth/verify-email',json={'token':token}).status_code,200)
        self.assertEqual(self.client.post('/auth/verify-email',json={'token':token}).status_code,400)
        from pathlib import Path
        from email import policy
        from email.parser import BytesParser
        send_link('mail@example.com','verify','http://testserver/verify-email#token='+token)
        email = BytesParser(policy=policy.default).parsebytes(next((Path(self.temp.name)/'outbox').glob('*.eml')).read_bytes())
        self.assertIn('href="http://testserver/verify-email#token=',email.get_body(preferencelist=('html',)).get_content())
        self.assertIn('#token=',email.get_body(preferencelist=('plain',)).get_content())

    def test_smtp_delivery_failure_does_not_verify_or_leave_token(self):
        with patch.object(routes,'send_link',side_effect=OSError('offline')):
            r=self.client.post('/auth/signup',json={'name':'Daksh','email':'mail@example.com','password':'test-password-1234'})
        self.assertEqual(r.status_code,503)
        with database() as db:
            self.assertEqual(db.execute('SELECT verified FROM users').fetchone()[0],0)
            self.assertEqual(db.execute('SELECT COUNT(*) FROM links').fetchone()[0],0)


if __name__ == '__main__': unittest.main()
