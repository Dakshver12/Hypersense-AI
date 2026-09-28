"""Authenticated account settings and explicit session revocation."""
from html import escape
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, RedirectResponse
from pydantic import BaseModel, Field
from backend.config import PROJECT_ROOT
from .database import database
from .security import (COOKIE, current_user, require_user, check_origin,
                       check_password, hash_password, limit, secure_cookie)

router = APIRouter()


class Profile(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=12, max_length=128)


class DeleteAccount(BaseModel):
    current_password: str = Field(min_length=1, max_length=128)
    confirmation: str


def settings_user(request: Request):
    check_origin(request)
    user = require_user(request)
    limit('settings:'+user['id'], 15, 900)
    return user


def verify_password(db, uid, password):
    row = db.execute('SELECT password FROM users WHERE id=?', (uid,)).fetchone()
    if not row or not check_password(password, row['password']):
        raise HTTPException(400, 'Current password is incorrect.')


def clear_cookie(response):
    response.delete_cookie(COOKIE, httponly=True, secure=secure_cookie(), samesite='lax')


@router.get('/account', response_class=HTMLResponse)
def account_page(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse('/login', status_code=303)
    page = (PROJECT_ROOT/'templates/account-settings.html').read_text(encoding='utf-8')
    return HTMLResponse(page.replace('<!-- account-id -->', escape(user['id'], quote=True)),
                        headers={'Cache-Control':'no-store'})


@router.patch('/api/account/profile')
def update_profile(data: Profile, user=Depends(settings_user)):
    name = data.name.strip()
    if not name:
        raise HTTPException(422, 'Enter your display name.')
    with database() as db:
        db.execute('UPDATE users SET name=? WHERE id=?', (name, user['id']))
    return {'message':'Display name updated.', 'name':name}


@router.post('/api/account/password')
def change_password(data: PasswordChange, response: Response, user=Depends(settings_user)):
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        verify_password(db, user['id'], data.current_password)
        if data.password == data.current_password:
            raise HTTPException(400, 'Choose a different password.')
        db.execute('UPDATE users SET password=? WHERE id=?', (hash_password(data.password), user['id']))
        db.execute('DELETE FROM logins WHERE user_id=?', (user['id'],))
        db.execute('DELETE FROM links WHERE user_id=?', (user['id'],))
    clear_cookie(response)
    return {'message':'Password changed. Sign in again on each device.'}


@router.post('/api/account/logout-all')
def logout_all(response: Response, user=Depends(settings_user)):
    with database() as db:
        db.execute('DELETE FROM logins WHERE user_id=?', (user['id'],))
    clear_cookie(response)
    return {'message':'Signed out of all devices.'}


@router.delete('/api/account')
def delete_account(data: DeleteAccount, response: Response, user=Depends(settings_user)):
    if data.confirmation != 'DELETE':
        raise HTTPException(400, 'Type DELETE to confirm.')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        verify_password(db, user['id'], data.current_password)
        db.execute('DELETE FROM users WHERE id=?', (user['id'],))
    clear_cookie(response)
    return {'message':'Account and server-saved interviews deleted.'}
