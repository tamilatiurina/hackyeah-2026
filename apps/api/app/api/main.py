from dotenv import load_dotenv
from fastapi import APIRouter

from app.api.routes import guardrails, items, mcp_servers, signatures
from app.api.routes.agents.router import router as agents_router

load_dotenv()

api_router = APIRouter()
api_router.include_router(items.router)
api_router.include_router(guardrails.router)
api_router.include_router(agents_router)
api_router.include_router(mcp_servers.router)
api_router.include_router(signatures.router)
