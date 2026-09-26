"""Compose a shared document from separately maintained screen fragments."""

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from backend.accounts.security import current_user
from html import escape
from backend.config import PROJECT_ROOT

router = APIRouter()
SCREEN_NAMES = ("dashboard", "setup", "interview", "camera-check", "results")


def render_shell():
    templates = PROJECT_ROOT / "templates"
    shell = (templates / "index.html").read_text(encoding="utf-8")
    for name in SCREEN_NAMES:
        shell = shell.replace(
            "<!-- include:" + name + " -->",
            (templates / "screens" / (name + ".html")).read_text(encoding="utf-8"),
        )
    return shell


@router.get("/interview", response_class=HTMLResponse)
@router.get("/camera-check", response_class=HTMLResponse)
@router.get("/results", response_class=HTMLResponse)
def page(request: Request):
    user = current_user(request)
    if not user:
        return RedirectResponse("/login", status_code=303)
    shell = render_shell().replace('<!-- account-meta -->', '<meta name="hypersense-account" content="'+escape(user['id'], quote=True)+'">')
    return HTMLResponse(shell, headers={"Cache-Control": "no-store"})
