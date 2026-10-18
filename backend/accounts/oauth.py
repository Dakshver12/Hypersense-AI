"""Browser-bound, single-use authorization-code sign-in for Google and GitHub."""
import base64
import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import time
import uuid
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
from .database import database
from .security import COOKIE, SESSION_SECONDS, current_user, digest, hash_password, limit, origin, secure_cookie

router = APIRouter()
PROVIDERS = {
    'google': {'authorize': 'https://accounts.google.com/o/oauth2/v2/auth',
               'token': 'https://oauth2.googleapis.com/token', 'scope': 'openid email profile'},
    'github': {'authorize': 'https://github.com/login/oauth/authorize',
               'token': 'https://github.com/login/oauth/access_token', 'scope': 'read:user user:email'},
}
ERRORS = {
    'not-configured': 'This sign-in provider is not configured yet. Use email sign-in.',
    'expired': 'This sign-in request expired or belongs to another browser. Start again.',
    'cancelled': 'Sign-in was cancelled. You can try again or use email.',
    'provider': 'The sign-in provider could not be reached. Please try again.',
    'verified-email': 'Choose a provider account with a verified email address.',
    'existing-account': 'This email already has a HyperSense account. Sign in with your password, then open Connected accounts in Settings to connect this provider.',
    'suspended': 'This account is suspended. Contact support.',
    'conflict': 'This provider account is already connected to another HyperSense account.',
    'sign-in-first': 'Sign in to your HyperSense account before connecting another sign-in method.',
}


def credentials(provider):
    if provider not in PROVIDERS:
        raise HTTPException(404, 'Unknown sign-in provider.')
    prefix = 'GOOGLE' if provider == 'google' else 'GITHUB'
    return tuple(os.getenv(prefix + suffix, '').strip() for suffix in ('_CLIENT_ID', '_CLIENT_SECRET'))


def enabled(provider):
    return all(credentials(provider))


def flow_cookie():
    return '__Host-hypersense_oauth' if secure_cookie() else 'hypersense_oauth'


def failure(code):
    response = RedirectResponse('/login?' + urlencode({'oauth_error': code}), status_code=303)
    response.delete_cookie(flow_cookie(), path='/', httponly=True, secure=secure_cookie(), samesite='lax')
    response.headers['Cache-Control'] = 'no-store'
    return response


@router.get('/auth/providers')
def provider_config():
    return {'providers': [p for p in PROVIDERS if enabled(p)]}


@router.get('/auth/oauth/{provider}/start')
def start(provider: str, request: Request, connect: bool = False):
    client_id, secret = credentials(provider)
    if not client_id or not secret:
        return failure('not-configured')
    limit('oauth-start:' + digest(request.client.host if request.client else 'unknown'), 30, 900)
    user = current_user(request) if connect else None
    if connect and not user:
        return failure('sign-in-first')
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b'=').decode()
    with database() as db:
        db.execute('DELETE FROM oauth_flows WHERE expires<?', (int(time.time()),))
        db.execute('INSERT INTO oauth_flows VALUES (?,?,?,?,?)',
                   (digest(state), provider, verifier, int(time.time()) + 600, user['id'] if user else None))
    params = {'client_id': client_id, 'redirect_uri': origin() + '/auth/oauth/' + provider + '/callback',
              'response_type': 'code', 'scope': PROVIDERS[provider]['scope'], 'state': state,
              'code_challenge': challenge, 'code_challenge_method': 'S256'}
    if provider == 'google':
        params['prompt'] = 'select_account'
    response = RedirectResponse(PROVIDERS[provider]['authorize'] + '?' + urlencode(params), status_code=303)
    response.set_cookie(flow_cookie(), state, max_age=600, httponly=True,
                        secure=secure_cookie(), samesite='lax', path='/')
    response.headers['Cache-Control'] = 'no-store'
    return response


def provider_identity(provider, code, verifier):
    client_id, secret = credentials(provider)
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        response = client.post(PROVIDERS[provider]['token'], data={
            'client_id': client_id, 'client_secret': secret, 'code': code,
            'redirect_uri': origin() + '/auth/oauth/' + provider + '/callback',
            'grant_type': 'authorization_code', 'code_verifier': verifier}, headers={'Accept': 'application/json'})
        response.raise_for_status()
        tokens = response.json()
        if not isinstance(tokens, dict):
            raise ValueError('provider')
        token = tokens.get('access_token')
        if not isinstance(token, str) or not token:
            raise ValueError('provider')
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': 'HyperSense-AI'}
        url = 'https://openidconnect.googleapis.com/v1/userinfo' if provider == 'google' else 'https://api.github.com/user'
        response = client.get(url, headers=headers)
        response.raise_for_status()
        profile = response.json()
        if not isinstance(profile, dict):
            raise ValueError('provider')
        if provider == 'google':
            if profile.get('email_verified') is not True:
                raise ValueError('verified-email')
            subject, email = profile.get('sub'), profile.get('email')
        else:
            subject = str(profile.get('id') or '')
            response = client.get('https://api.github.com/user/emails', headers=headers)
            response.raise_for_status()
            values = response.json()
            if not isinstance(values, list):
                raise ValueError('provider')
            addresses = [x for x in values if isinstance(x, dict) and x.get('verified') is True and isinstance(x.get('email'), str)]
            addresses.sort(key=lambda x: x.get('primary') is not True)
            email = addresses[0]['email'] if addresses else ''
        email = email.strip().lower() if isinstance(email, str) else ''
        if not isinstance(subject, str) or not subject or len(subject) > 255:
            raise ValueError('provider')
        if len(email) > 254 or not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', email):
            raise ValueError('verified-email')
        name = profile.get('name') or profile.get('login') or email.split('@')[0]
        return subject, email, str(name).strip()[:80] or 'HyperSense user'


def resolve_account(provider, subject, email, name, link_user=None):
    # A verified provider email never silently takes over an existing local account.
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        identity = db.execute('SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?', (provider, subject)).fetchone()
        if identity:
            uid = identity['user_id']
            if link_user and uid != link_user:
                raise ValueError('conflict')
        elif link_user:
            uid = link_user
            db.execute('INSERT INTO oauth_identities VALUES (?,?,?)', (provider, subject, uid))
        else:
            if db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
                raise ValueError('existing-account')
            uid = str(uuid.uuid4())
            new_password = hash_password(secrets.token_urlsafe(48))
            db.execute('INSERT INTO users VALUES (?,?,?,?,1,?)', (uid, email, name, new_password, int(time.time())))
            db.execute('INSERT INTO oauth_identities VALUES (?,?,?)', (provider, subject, uid))
        user = db.execute('SELECT verified FROM users WHERE id=?', (uid,)).fetchone()
        if not user or not user['verified']:
            raise ValueError('sign-in-first')
        if db.execute('SELECT 1 FROM account_suspensions WHERE user_id=?', (uid,)).fetchone():
            raise ValueError('suspended')
    return uid


@router.get('/auth/oauth/{provider}/callback')
def callback(provider: str, request: Request, state: str = '', code: str = '', error: str = ''):
    if not enabled(provider):
        return failure('not-configured')
    cookie = request.cookies.get(flow_cookie(), '')
    if len(state) != 43 or not cookie or not hmac.compare_digest(state, cookie):
        return failure('expired')
    with database() as db:
        # DELETE RETURNING consumes the flow atomically, including across workers.
        flow = db.execute('DELETE FROM oauth_flows WHERE state=? AND provider=? AND expires>? RETURNING verifier,user_id',
                          (digest(state), provider, int(time.time()))).fetchone()
    if not flow:
        return failure('expired')
    if error:
        return failure('cancelled')
    if not code or len(code) > 4096:
        return failure('expired')
    link_user = flow['user_id']
    if link_user:
        user = current_user(request)
        if not user or user['id'] != link_user:
            return failure('sign-in-first')
    try:
        subject, email, name = provider_identity(provider, code, flow['verifier'])
        uid = resolve_account(provider, subject, email, name, link_user)
    except ValueError as exc:
        return failure(str(exc) if str(exc) in ERRORS else 'provider')
    except (httpx.HTTPError, sqlite3.Error, TypeError, KeyError):
        return failure('provider')
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        if db.execute('SELECT 1 FROM account_suspensions WHERE user_id=?', (uid,)).fetchone():
            return failure('suspended')
        db.execute('DELETE FROM logins WHERE expires<? OR token=?', (int(time.time()), digest(request.cookies.get(COOKIE, ''))))
        db.execute('INSERT INTO logins VALUES (?,?,?)', (digest(token), uid, int(time.time()) + SESSION_SECONDS))
    response = RedirectResponse('/account' if link_user else '/interview', status_code=303)
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True,
                        secure=secure_cookie(), samesite='lax', path='/')
    response.delete_cookie(flow_cookie(), path='/', httponly=True, secure=secure_cookie(), samesite='lax')
    response.headers['Cache-Control'] = 'no-store'
    return response
