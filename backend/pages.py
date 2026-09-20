"""Compose a shared document from separately maintained screen fragments."""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse
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
def page():
    return HTMLResponse(render_shell(), headers={"Cache-Control": "no-cache"})
