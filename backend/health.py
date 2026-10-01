"""Public liveness probe; no credentials or external API calls."""
from fastapi import APIRouter

router = APIRouter()

@router.get("/healthz", include_in_schema=False)
def health():
    return {"status": "ok"}
