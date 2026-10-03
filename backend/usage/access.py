"""Admin access is configured server-side and requires a verified active login."""
import os
from fastapi import HTTPException, Request
from backend.accounts.security import require_user


def is_admin(user):
    allowed = {value.strip().casefold() for value in os.getenv('HYPERSENSE_ADMIN_EMAILS', '').split(',') if value.strip()}
    return bool(user and user['email'].casefold() in allowed)


def require_admin(request: Request):
    user = require_user(request)
    if not is_admin(user):
        raise HTTPException(403, 'Administrator access is required.')
    return user
