from dotenv import load_dotenv
from fastapi import APIRouter

from app.api.routes import bindings, gateway_keys, guardrails, items, mcp_servers, signatures
from app.api.routes.agents.router import router as agents_router
from app.api.routes.pi_policy.playground_routes import router as pi_playground_router
from app.api.routes.pi_policy.routes import router as pi_policy_router

load_dotenv()

api_router = APIRouter()
api_router.include_router(items.router)
api_router.include_router(guardrails.router)
api_router.include_router(bindings.router)
api_router.include_router(agents_router)
api_router.include_router(gateway_keys.router)
api_router.include_router(mcp_servers.router)
api_router.include_router(signatures.router)
api_router.include_router(pi_policy_router)
api_router.include_router(pi_playground_router)
