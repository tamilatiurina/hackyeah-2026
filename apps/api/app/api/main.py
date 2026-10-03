from fastapi import APIRouter

from app.api.routes import guardrails, items, signatures

api_router = APIRouter()
api_router.include_router(items.router)
api_router.include_router(guardrails.router)
api_router.include_router(signatures.router)
