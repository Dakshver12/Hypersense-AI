from html import escape
from fastapi import HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from backend.accounts.security import current_user
from backend.config import PROJECT_ROOT
from backend.usage.access import is_admin


def admin_page(request, template, active):
    user = current_user(request)
    if not user:
        return RedirectResponse('/login', status_code=303)
    if not is_admin(user):
        raise HTTPException(403, 'Administrator access is required.')
    directory = PROJECT_ROOT/'templates'
    nav = (directory/'admin-nav.html').read_text(encoding='utf-8')
    nav = nav.replace('data-page="'+active+'"', 'data-page="'+active+'" aria-current="page"')
    html = (directory/template).read_text(encoding='utf-8')
    html = html.replace('<!-- admin-nav -->', nav).replace('<!-- account-id -->', escape(user['id'], quote=True))
    return HTMLResponse(html, headers={'Cache-Control':'no-store'})
