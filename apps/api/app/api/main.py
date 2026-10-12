from dotenv import load_dotenv
from fastapi import APIRouter, Depends

from app.api.routes import (
    agent_mcp_servers,
    audit,
    bindings,
    gateway_keys,
    guardrails,
    mcp_servers,
    me,
    security,
    signatures,
    test_chat,
)
from app.api.routes.agents.router import router as agents_router
from app.core.auth import get_current_user

load_dotenv()

# Every panel route needs a signed-in user; the gateway (/a/...) uses agent keys instead.
api_router = APIRouter(dependencies=[Depends(get_current_user)])
api_router.include_router(guardrails.router)
api_router.include_router(bindings.router)
api_router.include_router(agents_router)
api_router.include_router(gateway_keys.router)
api_router.include_router(test_chat.router)
api_router.include_router(security.router)
api_router.include_router(mcp_servers.router)
api_router.include_router(agent_mcp_servers.router)
api_router.include_router(signatures.router)
api_router.include_router(audit.router)
api_router.include_router(me.router)
