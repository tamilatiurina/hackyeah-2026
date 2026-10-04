"""B-01/B-02: the guarded A2A URL for every proxy agent (docs/agent-contract-a2a.md, §5).

GET  /a/<agent id>/.well-known/agent-card.json
     The Agent Card stored at registration, rewritten for the gateway: one JSON-RPC interface
     at /a/<agent id>, no streaming or push notifications, and the key in X-API-Key as the only
     security scheme.

POST /a/<agent id>
     Accepts A2A SendMessage (JSON-RPC 2.0). Checks the key in X-API-Key (missing or wrong ->
     401), then forwards the call unchanged to the agent's JSON-RPC endpoint (upstream_url,
     taken from its card at registration) with A2A-Version: 1.0 and the stored auth header.
     The whole reply is read before answering. Other A2A methods get -32004; an unreachable
     upstream -32603.

     B-02: input guardrails run on the user message first (a block answers without calling
     the agent; a redaction changes what it receives), output guardrails on the reply, and the
     trace goes in the reply's metadata.guardrailHub. With no guardrails at all, the call and
     the reply pass through byte for byte. The caller's role (params.metadata.guardrailHub.role,
     or the demo's top-level role) selects role bindings and is reported in the hub data.

After a successful forward the gateway counts the turn for the message's contextId, and every
block, redaction and warning is recorded as an audit event (A-07, B-06). The steps live in
app.gateway.service, shared with the panel's test chat.

The agent's id stands in for the deployment slug until deployments exist (B-03).
"""

from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader

from app.audit.recorder import AuditRecorder, get_audit_recorder
from app.gateway import a2a
from app.gateway.pipeline import GuardrailEngine
from app.gateway.policy import PolicyLoader, get_policy_loader, read_role
from app.gateway.resolver import AgentResolver, get_agent_resolver
from app.gateway.service import (
    Audit,
    get_gateway_http_client,
    get_guardrail_engine,
    send_guarded,
)
from app.mcp.agent_access import McpGrantLoader, get_gateway_mcp_loader, load_grants

__all__ = ["get_gateway_http_client", "get_guardrail_engine", "router"]

router = APIRouter(tags=["gateway"])
_api_key = APIKeyHeader(name=a2a.API_KEY_HEADER, auto_error=False)


def _is_uuid(value: str) -> bool:
    try:
        UUID(value)
    except ValueError:
        return False
    return True


def _unauthorized() -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        "Invalid or missing gateway key",
        headers={"WWW-Authenticate": a2a.API_KEY_HEADER},
    )


@router.get("/a/{agent_id}" + a2a.AGENT_CARD_PATH)
async def agent_card(
    agent_id: str,
    request: Request,
    resolver: Annotated[AgentResolver, Depends(get_agent_resolver)],
) -> JSONResponse:
    # Agents registered before A2A have no stored card; they look the same as unknown ones.
    upstream_card = (
        await run_in_threadpool(resolver.agent_card, agent_id) if _is_uuid(agent_id) else None
    )
    if upstream_card is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
    gateway_url = str(request.url_for("forward_to_agent", agent_id=agent_id))
    return JSONResponse(a2a.guarded_card(upstream_card, gateway_url))


@router.post("/a/{agent_id}")
async def forward_to_agent(
    agent_id: str,
    request: Request,
    key: Annotated[str | None, Depends(_api_key)],
    resolver: Annotated[AgentResolver, Depends(get_agent_resolver)],
    policies: Annotated[PolicyLoader, Depends(get_policy_loader)],
    engine: Annotated[GuardrailEngine, Depends(get_guardrail_engine)],
    client: Annotated[httpx.AsyncClient, Depends(get_gateway_http_client)],
    recorder: Annotated[AuditRecorder, Depends(get_audit_recorder)],
    mcp: Annotated[McpGrantLoader, Depends(get_gateway_mcp_loader)],
) -> Response:
    if not key or not _is_uuid(agent_id):
        raise _unauthorized()
    target = await run_in_threadpool(resolver.resolve, agent_id, key)
    if target is None:  # unknown agent and wrong key look the same, so ids can't be probed
        raise _unauthorized()

    # --- only A2A SendMessage goes through ---
    body = await request.body()
    call, error = a2a.parse_send_message(body)
    if call is None:
        return JSONResponse(error)  # JSON-RPC answers HTTP 200 even for errors

    role, stripped = read_role(call)  # role bindings apply; a demo top-level role is removed

    policy = await run_in_threadpool(policies.load, agent_id, key, role)
    grants = await run_in_threadpool(load_grants, mcp, agent_id, key)
    reply = await send_guarded(
        call,
        target=target,
        policy=policy,
        engine=engine,
        client=client,
        audit=Audit(recorder=recorder, agent_id=agent_id, key=key),
        role=role,
        raw_body=None if stripped else body,
        mcp_servers=[grant.for_agent() for grant in grants],
    )
    if reply.raw is not None:  # the agent's answer, byte for byte
        return Response(
            content=reply.raw, status_code=reply.status_code, media_type=reply.media_type
        )
    return JSONResponse(reply.body)
