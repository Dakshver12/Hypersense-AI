import os
import re
import secrets
import sqlite3
import time
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field, field_validator
from backend.config import PROJECT_ROOT
from .database import database
from .security import (COOKIE, SESSION_SECONDS, origin, secure_cookie, digest,
                       hash_password, check_password, check_origin, limit, current_user, require_user)
from .mail import send_link

router = APIRouter()


class Credentials(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(min_length=12, max_length=128)

    @field_validator('email')
    @classmethod
    def email_address(cls, value):
        value = value.strip().lower()
        if not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Enter a valid email address.')
        return value


class Signup(Credentials):
    name: str = Field(min_length=1, max_length=80)


class EmailOnly(BaseModel):
    email: str = Field(max_length=254)


class LinkToken(BaseModel):
    token: str = Field(min_length=32, max_length=128)


class Reset(LinkToken):
    password: str = Field(min_length=12, max_length=128)


def auth_limit(request: Request):
    check_origin(request)
    limit('auth-ip:'+digest(request.client.host if request.client else 'unknown'), 20, 900)


def issue_link(user, purpose):
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute('DELETE FROM links WHERE expires<?', (int(time.time()),))
        db.execute('INSERT INTO links VALUES (?,?,?,?)', (digest(token),user['id'],purpose,int(time.time())+1800))
    route = '/verify-email' if purpose == 'verify' else '/reset-password'
    link = origin()+route+'#token='+token
    try:
        dev_link = send_link(user['email'], purpose, link)
    except Exception:
        with database() as db:
            db.execute('DELETE FROM links WHERE token=?', (digest(token),))
        raise HTTPException(503, 'Email delivery is unavailable. Please try again later.') from None
    return dev_link


@router.get('/', include_in_schema=False)
def home(request: Request):
    return RedirectResponse('/interview' if current_user(request) else '/login', status_code=303)


@router.get('/login', response_class=HTMLResponse)
@router.get('/signup', response_class=HTMLResponse)
@router.get('/forgot-password', response_class=HTMLResponse)
@router.get('/reset-password', response_class=HTMLResponse)
@router.get('/verify-email', response_class=HTMLResponse)
def auth_page(request: Request):
    if request.url.path in ('/login','/signup') and current_user(request):
        return RedirectResponse('/interview', status_code=303)
    text = (PROJECT_ROOT/'templates/auth.html').read_text(encoding='utf-8')
    hint = 'Development email is saved in data/outbox (or your configured data directory).' if os.getenv('MAIL_MODE','file') == 'file' and os.getenv('APP_ENV','development') != 'production' else 'Check your inbox for the verification or reset link.'
    return HTMLResponse(text.replace('<!-- mail-hint -->',hint), headers={'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})


@router.post('/auth/signup', dependencies=[Depends(auth_limit)])
def signup(data: Signup):
    if not data.name.strip():
        raise HTTPException(422, 'Enter your name.')
    dev_link = None
    with database() as db:
        user = db.execute('SELECT * FROM users WHERE email=?', (data.email,)).fetchone()
    if not user:
        uid = str(uuid.uuid4())
        password = hash_password(data.password)
        try:
            with database() as db:
                db.execute('INSERT INTO users VALUES (?,?,?,?,0,?)', (uid,data.email,data.name.strip(),password,int(time.time())))
            user = {'id':uid,'email':data.email,'verified':0}
        except sqlite3.IntegrityError:
            user = None
    if user and not user['verified']:
        dev_link = issue_link(user, 'verify')
    response = {'message':'If this address is eligible, a verification link has been sent. Already registered? Sign in or reset your password.'}
    if dev_link:
        response['dev_link'] = dev_link
    return response


@router.post('/auth/login', dependencies=[Depends(auth_limit)])
def login(data: Credentials, response: Response, request: Request):
    limit('login-email:'+digest(data.email), 10, 900)
    with database() as db:
        user = db.execute('SELECT * FROM users WHERE email=?', (data.email,)).fetchone()
    if not user:
        hash_password(data.password)  # Comparable password-work for unknown accounts.
        raise HTTPException(401, 'Email or password is incorrect.')
    if not check_password(data.password, user['password']):
        raise HTTPException(401, 'Email or password is incorrect.')
    if not user['verified']:
        raise HTTPException(403, 'Verify your email before signing in. Use Resend verification below.')
    token = secrets.token_urlsafe(32)
    with database() as db:
        db.execute('DELETE FROM logins WHERE expires<? OR token=?', (int(time.time()),digest(request.cookies.get(COOKIE,''))))
        db.execute('INSERT INTO logins VALUES (?,?,?)', (digest(token),user['id'],int(time.time())+SESSION_SECONDS))
    response.set_cookie(COOKIE, token, max_age=SESSION_SECONDS, httponly=True, secure=secure_cookie(), samesite='lax')
    response.headers['Cache-Control'] = 'no-store'
    return {'message':'Signed in.'}


@router.post('/auth/logout', dependencies=[Depends(check_origin)])
def logout(request: Request, response: Response):
    if current_user(request):
        require_user(request)
    with database() as db:
        db.execute('DELETE FROM logins WHERE token=?', (digest(request.cookies.get(COOKIE,'')),))
    response.delete_cookie(COOKIE, httponly=True, secure=secure_cookie(), samesite='lax')
    return {'message':'Signed out.'}


@router.get('/auth/me')
def me(user=Depends(require_user)):
    return user


@router.post('/auth/resend-verification', dependencies=[Depends(auth_limit)])
@router.post('/auth/forgot-password', dependencies=[Depends(auth_limit)])
def send_email(data: EmailOnly, request: Request):
    email = data.email.strip().lower()
    limit('mail:'+digest(email), 3, 900)
    dev_link = None
    with database() as db:
        user = db.execute('SELECT * FROM users WHERE email=?', (email,)).fetchone()
    purpose = 'verify' if request.url.path.endswith('resend-verification') else 'reset'
    if user and (purpose == 'reset' or not user['verified']):
        dev_link = issue_link(user,purpose)
    response = {'message':'If the account is eligible, an email has been sent.'}
    if dev_link:
        response['dev_link'] = dev_link
    return response


@router.post('/auth/verify-email', dependencies=[Depends(auth_limit)])
def verify(data: LinkToken):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        link = db.execute('SELECT * FROM links WHERE token=? AND purpose=? AND expires>?', (digest(data.token),'verify',int(time.time()))).fetchone()
        if not link:
            raise HTTPException(400,'This link is invalid or expired. Request a new verification email.')
        db.execute('UPDATE users SET verified=1 WHERE id=?', (link['user_id'],))
        db.execute('DELETE FROM links WHERE user_id=? AND purpose=?',(link['user_id'],'verify'))
    return {'message':'Email verified. You can now sign in.'}


@router.post('/auth/reset-password', dependencies=[Depends(auth_limit)])
def reset(data: Reset):
    password = hash_password(data.password)
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        link = db.execute('SELECT * FROM links WHERE token=? AND purpose=? AND expires>?', (digest(data.token),'reset',int(time.time()))).fetchone()
        if not link:
            raise HTTPException(400,'This link is invalid or expired. Request a new password reset.')
        db.execute('UPDATE users SET password=? WHERE id=?',(password,link['user_id']))
        db.execute('DELETE FROM logins WHERE user_id=?',(link['user_id'],))
        db.execute('DELETE FROM links WHERE user_id=?',(link['user_id'],))
    return {'message':'Password updated. Sign in with your new password.'}
