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
     the reply pass through byte for byte.

After a successful forward the gateway counts the turn for the message's contextId (A-07).

The agent's id stands in for the deployment slug until deployments exist (B-03).
"""

import json
import logging
from collections.abc import AsyncIterator
from typing import Annotated, Any
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader
from pydantic import HttpUrl, ValidationError

from app.api.routes.agents.deps import ensure_public_upstream
from app.audit.recorder import AuditRecorder, get_audit_recorder
from app.gateway import a2a
from app.gateway.pipeline import GuardrailEngine, LocalEngine, StageOutcome, dump_trace, run_stage
from app.gateway.policy import PolicyLoader, get_policy_loader
from app.gateway.resolver import AgentResolver, get_agent_resolver

UPSTREAM_TIMEOUT_SECONDS = 30.0

logger = logging.getLogger(__name__)
router = APIRouter(tags=["gateway"])
_api_key = APIKeyHeader(name=a2a.API_KEY_HEADER, auto_error=False)


class UpstreamError(Exception):
    """The upstream agent couldn't be reached or answered with something unusable."""

    def __init__(self, message: str, reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason


async def get_gateway_http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        follow_redirects=False, timeout=UPSTREAM_TIMEOUT_SECONDS
    ) as client:
        yield client


def get_guardrail_engine() -> GuardrailEngine:
    return LocalEngine()


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


def _rpc_error(rpc_id: Any, code: int, message: str, reason: str | None = None) -> JSONResponse:
    # JSON-RPC answers HTTP 200 even for errors; the outcome is in the body.
    return JSONResponse(a2a.rpc_error(rpc_id, code, message, reason))


async def _post_upstream(
    client: httpx.AsyncClient, url: str, headers: dict[str, str], content: bytes
) -> httpx.Response:
    """One call to the upstream, after the SSRF check (public address only, IP pinned)."""
    try:
        upstream = await ensure_public_upstream(HttpUrl(url))
    except (HTTPException, ValidationError) as error:
        raise UpstreamError("Upstream address is not allowed") from error
    request = client.build_request(
        "POST",
        upstream.url,
        content=content,
        headers=headers,
        extensions={"sni_hostname": upstream.sni_hostname},
    )
    request.headers["Host"] = upstream.host_header
    try:
        # send() without stream=True reads the entire body: streamed replies are buffered.
        return await client.send(request)
    except httpx.TimeoutException as error:
        raise UpstreamError("Upstream agent did not answer in time", "timeout") from error
    except httpx.HTTPError as error:
        raise UpstreamError("Upstream agent could not be reached", "unreachable") from error


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
) -> Response:
    if not key or not _is_uuid(agent_id):
        raise _unauthorized()
    target = await run_in_threadpool(resolver.resolve, agent_id, key)
    if target is None:  # unknown agent and wrong key look the same, so ids can't be probed
        raise _unauthorized()

    # --- only A2A SendMessage goes through ---
    body = await request.body()
    try:
        call = json.loads(body)
    except ValueError:
        return _rpc_error(None, a2a.PARSE_ERROR, "Body is not valid JSON")
    if not isinstance(call, dict) or call.get("jsonrpc") != a2a.JSONRPC_VERSION:
        return _rpc_error(None, a2a.INVALID_REQUEST, "Expected a JSON-RPC 2.0 call")
    rpc_id = call.get("id")
    if call.get("method") != a2a.SEND_MESSAGE:
        return _rpc_error(rpc_id, a2a.UNSUPPORTED_OPERATION, "Only SendMessage is supported")
    params = call.get("params")
    if not isinstance(params, dict) or not isinstance(params.get("message"), dict):
        return _rpc_error(rpc_id, a2a.INVALID_PARAMS, "params.message is required")
    message = params["message"]

    # --- B-02: input guardrails ---
    policy = await run_in_threadpool(policies.load, agent_id, key)
    guarded = bool(policy.input or policy.output)
    inbound = run_stage(policy.input, "input", [message], engine)
    if inbound.blocked_reason is not None:
        return _blocked(rpc_id, message, "input", inbound)
    if guarded:
        body = json.dumps(call).encode()  # the call with any redactions applied

    # --- forward to the agent's JSON-RPC endpoint ---
    headers = {"Content-Type": "application/json", a2a.A2A_VERSION_HEADER: a2a.A2A_VERSION}
    if target.auth_header_name and target.auth_header_value:
        headers[target.auth_header_name] = target.auth_header_value
    try:
        response = await _post_upstream(client, target.upstream_url, headers, body)
    except UpstreamError as error:
        return _rpc_error(rpc_id, a2a.INTERNAL_ERROR, str(error), error.reason)
    try:
        reply = response.json()
    except ValueError:  # e.g. a crash page or a plain-text 401 from the agent
        return _rpc_error(
            rpc_id,
            a2a.INTERNAL_ERROR,
            f"Upstream agent answered HTTP {response.status_code} without JSON-RPC",
            "invalid_response",
        )

    if not isinstance(reply, dict) or (
        "error" not in reply and not a2a.is_valid_send_message_result(reply.get("result"))
    ):
        return _rpc_error(
            rpc_id,
            a2a.INTERNAL_ERROR,
            "Upstream agent returned an invalid response (a task must be finished)",
            "invalid_response",
        )
    if "error" not in reply:
        await _count_turn(recorder, agent_id, key, message, reply)
    if not guarded or "error" in reply:
        # A result with no guardrails, or the agent's own JSON-RPC error: byte for byte.
        return Response(
            content=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type", "application/json"),
        )

    # --- B-02: output guardrails ---
    result = reply["result"]
    outbound = run_stage(policy.output, "output", a2a.reply_holders(result), engine)
    trace = inbound.trace + outbound.trace
    if outbound.blocked_reason is not None:
        return _blocked(
            rpc_id,
            message,
            "output",
            StageOutcome(trace=trace, blocked_reason=outbound.blocked_reason),
        )
    a2a.add_hub_metadata(result, {"trace": dump_trace(trace)})
    return JSONResponse(reply)


async def _count_turn(
    recorder: AuditRecorder, agent_id: str, key: str, message: a2a.Json, reply: a2a.Json
) -> None:
    """A-07: count the turn the agent answered (no content). Failures never change the reply."""
    context_id = message.get("contextId")
    if not isinstance(context_id, str) or not context_id:
        return
    try:
        input_tokens, output_tokens = a2a.usage_tokens(reply)
        await run_in_threadpool(
            recorder.record_turn, agent_id, key, context_id, input_tokens, output_tokens, 0.0
        )
    except Exception:  # noqa: BLE001 - audit storage must not break a successful call
        logger.warning("Could not record a turn for agent %s", agent_id, exc_info=True)


def _blocked(rpc_id: Any, message: a2a.Json, stage: str, outcome: StageOutcome) -> JSONResponse:
    """The refusal task for a blocked call; the agent's reply, if any, is never shown."""
    hub = {"blocked": True, "stage": stage, "trace": dump_trace(outcome.trace)}
    task = a2a.rejected_task(message.get("contextId"), outcome.blocked_reason or "Blocked", hub)
    return JSONResponse({"jsonrpc": a2a.JSONRPC_VERSION, "id": rpc_id, "result": task})
