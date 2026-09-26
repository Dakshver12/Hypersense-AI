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


def current_user(request: Request):
    token = request.cookies.get(COOKIE, '')
    if not token:
        return None
    with database() as db:
        row = db.execute('''SELECT users.id, users.email, users.name FROM logins
          JOIN users ON users.id=logins.user_id WHERE logins.token=? AND logins.expires>?
          AND users.verified=1''', (digest(token), int(time.time()))).fetchone()
    return dict(row) if row else None


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
    user = require_user(request)
    if request.url.path == '/detect-face':
        limit('face:'+user['id'], 600, 60)
    else:
        limit('ai-minute:'+user['id'], 20, 60)
        limit('ai-day:'+user['id'], int(os.getenv('AI_DAILY_LIMIT', '100')), 86400)
    return user
