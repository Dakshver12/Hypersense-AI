"""Browser-bound, single-use authorization-code sign-in for Google and GitHub."""
import base64
import hashlib
import hmac
import logging
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
logger = logging.getLogger(__name__)
PROVIDERS = {
    'google': {'authorize': 'https://accounts.google.com/o/oauth2/v2/auth',
               'token': 'https://oauth2.googleapis.com/token', 'scope': 'openid email profile'},
    'github': {'authorize': 'https://github.com/login/oauth/authorize',
               'token': 'https://github.com/login/oauth/access_token', 'scope': 'read:user user:email'},
}
ERRORS = {
    'oauth-credentials': 'The provider rejected the website client credentials. The site administrator needs to check the provider Client ID and Client secret.',
    'oauth-callback': 'The provider callback URL does not match the website configuration. Contact the site administrator.',
    'oauth-code': 'The provider sign-in code expired or was rejected. Start a fresh sign-in from this website.',
    'oauth-network': 'The website could not connect to the sign-in provider. Please try again shortly.',
    'oauth-permissions': 'The provider did not grant the required profile or email access. Please try again or contact support.',
    'oauth-database': 'Provider sign-in reached account setup, but saving the account failed. Contact the site administrator.',
    'not-configured': 'This sign-in provider is not configured yet. Use email sign-in.',
    'expired': 'This sign-in request expired or belongs to another browser. Start again.',
    'cancelled': 'Sign-in was cancelled. You can try again or use email.',
    'provider': 'The provider rejected sign-in or returned an unexpected response. Please retry or contact support.',
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



class OAuthFailure(ValueError):
    pass


def _provider_json(provider, stage, operation):
    """Only fixed diagnostic categories are logged: never codes, secrets or bodies."""
    try:
        response = operation()
    except httpx.RequestError as exc:
        logger.warning('OAuth failure provider=%s stage=%s category=network type=%s', provider, stage, type(exc).__name__)
        raise OAuthFailure('oauth-network') from None
    known = {'invalid_client', 'incorrect_client_credentials', 'redirect_uri_mismatch',
             'invalid_grant', 'bad_verification_code', 'invalid_scope', 'access_denied', 'unauthorized_client'}
    try:
        data = response.json()
    except ValueError:
        data = None
    reason = data.get('error') if isinstance(data, dict) else None
    reason = reason if isinstance(reason, str) and reason in known else 'unspecified'
    if response.status_code >= 400 or (isinstance(data, dict) and data.get('error')):
        logger.warning('OAuth failure provider=%s stage=%s status=%s reason=%s', provider, stage, response.status_code, reason)
        category = ('oauth-credentials' if reason in {'invalid_client', 'incorrect_client_credentials', 'unauthorized_client'} else
                    'oauth-callback' if reason == 'redirect_uri_mismatch' else
                    'oauth-code' if reason in {'invalid_grant', 'bad_verification_code'} else
                    'oauth-permissions' if reason in {'invalid_scope', 'access_denied'} or (stage != 'token' and response.status_code == 403) else 'provider')
        raise OAuthFailure(category)
    if response.status_code not in range(200, 300) or data is None:
        logger.warning('OAuth failure provider=%s stage=%s status=%s reason=invalid-response', provider, stage, response.status_code)
        raise OAuthFailure('provider')
    return data

def provider_identity(provider, code, verifier):
    client_id, secret = credentials(provider)
    with httpx.Client(timeout=15, follow_redirects=False) as client:
        tokens = _provider_json(provider, 'token', lambda: client.post(PROVIDERS[provider]['token'], data={
            'client_id': client_id, 'client_secret': secret, 'code': code,
            'redirect_uri': origin() + '/auth/oauth/' + provider + '/callback',
            'grant_type': 'authorization_code', 'code_verifier': verifier}, headers={'Accept': 'application/json'}))
        if not isinstance(tokens, dict):
            raise ValueError('provider')
        token = tokens.get('access_token')
        if not isinstance(token, str) or not token:
            logger.warning('OAuth failure provider=%s stage=token reason=missing-access-token', provider)
            raise ValueError('provider')
        headers = {'Authorization': 'Bearer ' + token, 'Accept': 'application/json', 'User-Agent': 'HyperSense-AI'}
        url = 'https://openidconnect.googleapis.com/v1/userinfo' if provider == 'google' else 'https://api.github.com/user'
        profile = _provider_json(provider, 'profile', lambda: client.get(url, headers=headers))
        if not isinstance(profile, dict):
            raise ValueError('provider')
        if provider == 'google':
            if profile.get('email_verified') is not True:
                raise ValueError('verified-email')
            subject, email = profile.get('sub'), profile.get('email')
        else:
            subject = str(profile.get('id') or '')
            values = _provider_json(provider, 'emails', lambda: client.get('https://api.github.com/user/emails', headers=headers))
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


class OAuthAccountError(Exception):
    """Account decisions must pass through the PostgreSQL transaction unchanged.

    The legacy adapter translates ValueError into sqlite3.OperationalError.
    Use a separate exception type for expected OAuth account outcomes.
    """


def resolve_account(provider, subject, email, name, link_user=None):
    # A verified provider email never silently takes over an existing local account.
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        identity = db.execute('SELECT user_id FROM oauth_identities WHERE provider=? AND subject=?', (provider, subject)).fetchone()
        if identity:
            uid = identity['user_id']
            if link_user and uid != link_user:
                raise OAuthAccountError('conflict')
        elif link_user:
            uid = link_user
            db.execute('INSERT INTO oauth_identities VALUES (?,?,?)', (provider, subject, uid))
        else:
            if db.execute('SELECT 1 FROM users WHERE email=?', (email,)).fetchone():
                raise OAuthAccountError('existing-account')
            uid = str(uuid.uuid4())
            new_password = hash_password(secrets.token_urlsafe(48))
            db.execute('INSERT INTO users VALUES (?,?,?,?,1,?)', (uid, email, name, new_password, int(time.time())))
            db.execute('INSERT INTO oauth_identities VALUES (?,?,?)', (provider, subject, uid))
        user = db.execute('SELECT verified FROM users WHERE id=?', (uid,)).fetchone()
        if not user or not user['verified']:
            raise OAuthAccountError('sign-in-first')
        if db.execute('SELECT 1 FROM account_suspensions WHERE user_id=?', (uid,)).fetchone():
            raise OAuthAccountError('suspended')
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
    except OAuthAccountError as exc:
        return failure(str(exc) if str(exc) in ERRORS else 'provider')
    except ValueError as exc:
        category = str(exc) if str(exc) in ERRORS else 'provider'
        if category == 'provider':
            logger.warning('OAuth failure provider=%s stage=identity reason=invalid-profile', provider)
        return failure(category)
    except sqlite3.Error as exc:
        logger.warning('OAuth failure provider=%s stage=account category=database type=%s', provider, type(exc).__name__)
        return failure('oauth-database')
    except (httpx.HTTPError, TypeError, KeyError) as exc:
        logger.warning('OAuth failure provider=%s stage=identity category=response type=%s', provider, type(exc).__name__)
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
