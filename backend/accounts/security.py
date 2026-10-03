"""Opaque revocable sessions, password hashing, origin checks and bounded usage."""
import hashlib
import hmac
import os
import secrets
import time
from urllib.parse import urlsplit
from fastapi import HTTPException, Request
from .database import database

COOKIE = 'hypersense_session'
SESSION_SECONDS = 60 * 60 * 24 * 7


def origin():
    value = os.getenv('APP_ORIGIN', 'http://127.0.0.1:8000').rstrip('/')
    parsed = urlsplit(value)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc or parsed.path or parsed.query or parsed.fragment or parsed.username:
        raise RuntimeError('APP_ORIGIN must contain only scheme and host, for example https://interviews.example.com')
    if os.getenv('APP_ENV', 'development') == 'production' and parsed.scheme != 'https':
        raise RuntimeError('Production requires HTTPS APP_ORIGIN')
    return value


def secure_cookie():
    return origin().startswith('https://')


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def hash_password(password):
    salt = secrets.token_hex(16)
    key = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), 600_000)
    return f'pbkdf2_sha256$600000${salt}${key.hex()}'


def check_password(password, encoded):
    try:
        _, rounds, salt, expected = encoded.split('$')
        key = hashlib.pbkdf2_hmac('sha256', password.encode(), bytes.fromhex(salt), int(rounds))
        return hmac.compare_digest(key.hex(), expected)
    except (ValueError, TypeError):
        return False


def check_origin(request: Request):
    if request.headers.get('origin') != origin():
        raise HTTPException(403, 'Request origin is not allowed. Open the configured HyperSense address.')
    if request.headers.get('sec-fetch-site') == 'cross-site':
        raise HTTPException(403, 'Cross-site requests are not allowed.')


def limit(bucket, maximum, seconds):
    now = int(time.time())
    denied = False
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        db.execute('DELETE FROM attempts WHERE at < ?', (now - 86400,))
        count = db.execute('SELECT COUNT(*) FROM attempts WHERE bucket=? AND at>?', (bucket, now-seconds)).fetchone()[0]
        denied = count >= maximum
        if not denied:
            db.execute('INSERT INTO attempts VALUES (?,?)', (bucket, now))
    if denied:
        raise HTTPException(429, 'Too many requests. Try again later.', headers={'Retry-After': str(seconds)})


def _lookup_user(db, token_digest, now):
    row = db.execute('''SELECT users.id, users.email, users.name FROM logins
      JOIN users ON users.id=logins.user_id WHERE logins.token=? AND logins.expires>?
      AND users.verified=1 AND NOT EXISTS
      (SELECT 1 FROM account_suspensions s WHERE s.user_id=users.id)''', (token_digest, now)).fetchone()
    return dict(row) if row else None


def current_user(request: Request):
    token = request.cookies.get(COOKIE, '')
    if not token:
        return None
    token_digest = digest(token)
    cached = getattr(request.state, '_hypersense_user', None)
    if cached is not None and cached[0] == token_digest:
        return dict(cached[1]) if cached[1] is not None else None
    with database(readonly=True) as db:
        user = _lookup_user(db, token_digest, int(time.time()))
    request.state._hypersense_user = (token_digest, user)
    return dict(user) if user is not None else None


def require_user(request: Request):
    user = current_user(request)
    if not user:
        raise HTTPException(401, 'Your session has expired. Sign in again.')
    # Prevent an old tab belonging to A from acting on B after an account switch.
    if request.headers.get('x-hypersense-account') != user['id']:
        raise HTTPException(409, 'The signed-in account changed. Reload this page before continuing.')
    return user


def require_practice_user(request: Request):
    check_origin(request)
    token = request.cookies.get(COOKIE, '')
    if not token:
        raise HTTPException(401, 'Your session has expired. Sign in again.')
    token_digest = digest(token)
    now = int(time.time())
    account_id = request.headers.get('x-hypersense-account', '')
    buckets = ([('face:'+account_id, 600, 60)] if request.url.path == '/detect-face' else
               [('ai-minute:'+account_id, 20, 60),
                ('ai-day:'+account_id, int(os.getenv('AI_DAILY_LIMIT', '100')), 86400)])
    with database() as db:
        user = _lookup_user(db, token_digest, now)
        if not user:
            raise HTTPException(401, 'Your session has expired. Sign in again.')
        if account_id != user['id']:
            raise HTTPException(409, 'The signed-in account changed. Reload this page before continuing.')
        db.execute('DELETE FROM attempts WHERE at < ?', (now - 86400,))
        denied = None
        for bucket, maximum, seconds in buckets:
            count = db.execute('SELECT COUNT(*) FROM attempts WHERE bucket=? AND at>?',
                               (bucket, now-seconds)).fetchone()[0]
            if count >= maximum:
                denied = seconds
        if denied is not None:
            raise HTTPException(429, 'Too many requests. Try again later.',
                                headers={'Retry-After': str(denied)})
        for bucket, _, _ in buckets:
            db.execute('INSERT INTO attempts VALUES (?,?)', (bucket, now))
    request.state._hypersense_user = (token_digest, user)
    return user
