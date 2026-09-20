"""HyperSense application entry point. Run: uv run uvicorn main:app --reload"""

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from backend.config import PROJECT_ROOT
from backend.api import router as api_router
from backend.pages import router as page_router

app = FastAPI(title="HyperSense AI")
app.mount("/static", StaticFiles(directory=PROJECT_ROOT / "static"), name="static")
app.include_router(api_router)
app.include_router(page_router)
