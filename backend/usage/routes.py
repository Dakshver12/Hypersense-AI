from html import escape
import sqlite3
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from backend.config import PROJECT_ROOT
from backend.accounts.security import current_user
from .access import is_admin, require_admin
from .store import snapshot

router = APIRouter()


@router.get('/admin/usage', response_class=HTMLResponse)
def usage_page(request: Request):
    from backend.admin.pages import admin_page
    return admin_page(request, 'admin-usage.html', 'usage')


@router.get('/api/admin/usage')
def usage_data(days: int = Query(7, ge=1, le=30), user=Depends(require_admin)):
    try:
        return snapshot(days)
    except (sqlite3.Error, OSError):
        raise HTTPException(503, 'Usage storage is unavailable. Try again later.') from None
