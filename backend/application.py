"""Application composition, startup validation and static asset policy."""

from fastapi import FastAPI, Depends
from contextlib import asynccontextmanager
import os
from fastapi.staticfiles import StaticFiles
from backend.config import PROJECT_ROOT
from backend.api import router as api_router
from backend.pages import router as page_router
from backend.health import router as health_router
from backend.usage.routes import router as usage_router
from backend.admin.routes import router as admin_router
from backend.support.routes import router as support_router

from backend.accounts.routes import router as auth_router
from backend.accounts.settings import router as settings_router
from backend.accounts.interviews import router as account_router
from backend.accounts.security import require_practice_user, origin
from backend.accounts.middleware import AccountSafetyMiddleware
from backend.accounts.database import database
from backend.accounts.mail import validate_mail_config


@asynccontextmanager
async def lifespan(app):
    origin()
    validate_mail_config()
    if os.getenv("APP_ENV") == "production" and (os.getenv("MAIL_MODE") != "smtp" or not os.getenv("SMTP_HOST") or not os.getenv("SMTP_FROM")):
        raise RuntimeError("Production requires SMTP_HOST, SMTP_FROM and MAIL_MODE=smtp")
    with database():
        pass
    yield


class RevalidatedStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


app = FastAPI(title="HyperSense AI", lifespan=lifespan)
app.add_middleware(AccountSafetyMiddleware)
app.include_router(health_router)
app.include_router(usage_router)
app.include_router(admin_router)
app.include_router(support_router)
app.include_router(auth_router)
app.include_router(settings_router)
app.include_router(account_router)
app.mount("/static", RevalidatedStaticFiles(directory=PROJECT_ROOT / "static"), name="static")
app.include_router(api_router, dependencies=[Depends(require_practice_user)])
app.include_router(page_router)
