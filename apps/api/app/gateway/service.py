"""One guarded SendMessage call, shared by the guarded URL (/a/<id>) and the test chat (B-06).

1. Input guardrails on the user message (a block answers without calling the agent; a
   redaction changes what the agent receives).
2. Forward to the agent's JSON-RPC endpoint with A2A-Version: 1.0 and its stored auth header.
3. Output guardrails on the reply, then the trace in metadata.guardrailHub.
4. Audit (A-07): the turn is counted when the agent answered, and every block, redaction and
   warning is recorded as an audit event. Audit failures are logged and never change the reply.
"""

import json
import logging
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Any

import httpx
from fastapi import HTTPException
from fastapi.concurrency import run_in_threadpool
from pydantic import HttpUrl, ValidationError

from app.api.routes.agents.deps import ensure_public_upstream
from app.audit.models import AuditEventIn
from app.audit.recorder import AuditRecorder
from app.bindings.models import EffectivePolicy
from app.gateway import a2a
from app.gateway.pipeline import (
    GuardrailEngine,
    LocalEngine,
    StageOutcome,
    TraceEntry,
    dump_trace,
    run_stage,
)
from app.gateway.resolver import UpstreamTarget

UPSTREAM_TIMEOUT_SECONDS = 30.0
_DETAILS_MAX = 500  # audit_events.details limit

logger = logging.getLogger(__name__)


async def get_gateway_http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        follow_redirects=False, timeout=UPSTREAM_TIMEOUT_SECONDS
    ) as client:
        yield client


def get_guardrail_engine() -> GuardrailEngine:
    return LocalEngine()


class UpstreamError(Exception):
    """The upstream agent couldn't be reached or answered with something unusable."""

    def __init__(self, message: str, reason: str | None = None) -> None:
        super().__init__(message)
        self.reason = reason


@dataclass
class Audit:
    """Where and as whom to record: the guarded URL passes the caller's gateway key; the test
    chat passes a recorder bound to the signed-in owner and an empty key."""

    recorder: AuditRecorder
    agent_id: str
    key: str = ""


@dataclass
class GuardedReply:
    body: a2a.Json  # the JSON-RPC response
    raw: bytes | None = None  # the agent's own bytes, when nothing was changed
    status_code: int = 200  # with `raw`: the agent's own HTTP status and content type
    media_type: str = "application/json"
    trace: list[TraceEntry] = field(default_factory=list)


async def post_upstream(
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


def audit_events(trace: list[TraceEntry], policy_version: str) -> list[AuditEventIn]:
    """The trace entries worth auditing: every block, redaction and warning (FR-28)."""
    return [
        AuditEventIn(
            rule_id=entry.guardrail_id,
            rule_name=entry.guardrail_name,
            kind="guardrail",
            stage=entry.stage,
            action=entry.verdict,
            config_version=policy_version,
            details=_details(entry),
        )
        for entry in trace
        if entry.verdict != "pass"
    ]


def _details(entry: TraceEntry) -> str:
    """The reason, never the message text. A simulated verdict always says so (it must never be
    reported as a real one), whatever wording its engine used."""
    reason = entry.reason
    if entry.simulated and not reason.startswith("Simulated"):
        reason = f"Simulated: {reason}"
    return reason[:_DETAILS_MAX]


async def _record_events(
    audit: Audit, context_id: Any, trace: list[TraceEntry], policy: EffectivePolicy
) -> None:
    events = audit_events(trace, policy.version)
    if not events:
        return
    session = context_id if isinstance(context_id, str) and context_id else None
    try:
        await run_in_threadpool(
            audit.recorder.record_events, audit.agent_id, audit.key, session, events
        )
    except Exception:  # noqa: BLE001 - audit storage must not break the call
        logger.warning("Could not record audit events for agent %s", audit.agent_id, exc_info=True)


async def _count_turn(audit: Audit, message: a2a.Json, reply: a2a.Json) -> None:
    """A-07: count the turn the agent answered (no content). Failures never change the reply."""
    context_id = message.get("contextId")
    if not isinstance(context_id, str) or not context_id:
        return
    try:
        input_tokens, output_tokens = a2a.usage_tokens(reply)
        await run_in_threadpool(
            audit.recorder.record_turn,
            audit.agent_id,
            audit.key,
            context_id,
            input_tokens,
            output_tokens,
            0.0,
        )
    except Exception:  # noqa: BLE001 - audit storage must not break a successful call
        logger.warning("Could not record a turn for agent %s", audit.agent_id, exc_info=True)


def _hub(policy: EffectivePolicy, role: str | None, trace: list[TraceEntry]) -> a2a.Json:
    """metadata.guardrailHub: the trace, the policy version and the caller's role."""
    hub: a2a.Json = {"trace": dump_trace(trace), "policyVersion": policy.version}
    if role is not None:
        hub["role"] = role
    return hub


def _blocked(
    rpc_id: Any,
    message: a2a.Json,
    stage: str,
    outcome: StageOutcome,
    policy: EffectivePolicy,
    role: str | None,
) -> a2a.Json:
    """The refusal task for a blocked call; the agent's reply, if any, is never shown."""
    hub = {"blocked": True, "stage": stage, **_hub(policy, role, outcome.trace)}
    task = a2a.rejected_task(message.get("contextId"), outcome.blocked_reason or "Blocked", hub)
    return {"jsonrpc": a2a.JSONRPC_VERSION, "id": rpc_id, "result": task}


async def send_guarded(
    call: a2a.Json,
    *,
    target: UpstreamTarget,
    policy: EffectivePolicy,
    engine: GuardrailEngine,
    client: httpx.AsyncClient,
    audit: Audit,
    role: str | None = None,
    raw_body: bytes | None = None,
) -> GuardedReply:
    """Run a validated SendMessage call through the guardrails and the agent.

    `raw_body` is the call as the caller sent it: with no guardrails it is forwarded as-is
    and the agent's answer comes back byte for byte. Pass None when the call was changed (for
    example a demo `role` field stripped off it). `role` selects role bindings and is reported.
    """
    rpc_id = call.get("id")
    message: a2a.Json = call["params"]["message"]
    context_id = message.get("contextId")

    # --- input guardrails ---
    guarded = bool(policy.input or policy.output)
    inbound = run_stage(policy.input, "input", [message], engine)
    if inbound.blocked_reason is not None:
        await _record_events(audit, context_id, inbound.trace, policy)
        refusal = _blocked(rpc_id, message, "input", inbound, policy, role)
        return GuardedReply(refusal, trace=inbound.trace)
    body = raw_body if raw_body is not None and not guarded else json.dumps(call).encode()

    # --- forward to the agent's JSON-RPC endpoint ---
    headers = {"Content-Type": "application/json", a2a.A2A_VERSION_HEADER: a2a.A2A_VERSION}
    if target.auth_header_name and target.auth_header_value:
        headers[target.auth_header_name] = target.auth_header_value
    try:
        response = await post_upstream(client, target.upstream_url, headers, body)
    except UpstreamError as error:
        await _record_events(audit, context_id, inbound.trace, policy)
        error_body = a2a.rpc_error(rpc_id, a2a.INTERNAL_ERROR, str(error), error.reason)
        return GuardedReply(error_body, trace=inbound.trace)
    try:
        reply = response.json()
    except ValueError:  # e.g. a crash page or a plain-text 401 from the agent
        reply = None
    if not isinstance(reply, dict) or (
        "error" not in reply and not a2a.is_valid_send_message_result(reply.get("result"))
    ):
        await _record_events(audit, context_id, inbound.trace, policy)
        text = (
            f"Upstream agent answered HTTP {response.status_code} without JSON-RPC"
            if reply is None
            else "Upstream agent returned an invalid response (a task must be finished)"
        )
        error_body = a2a.rpc_error(rpc_id, a2a.INTERNAL_ERROR, text, "invalid_response")
        return GuardedReply(error_body, trace=inbound.trace)

    if "error" not in reply:
        await _count_turn(audit, message, reply)
    if not guarded or "error" in reply:
        # No guardrails, or the agent's own JSON-RPC error: passed through byte for byte.
        await _record_events(audit, context_id, inbound.trace, policy)
        return GuardedReply(
            reply,
            raw=response.content,
            status_code=response.status_code,
            media_type=response.headers.get("content-type", "application/json"),
            trace=inbound.trace,
        )

    # --- output guardrails ---
    result = reply["result"]
    outbound = run_stage(policy.output, "output", a2a.reply_holders(result), engine)
    trace = inbound.trace + outbound.trace
    await _record_events(audit, context_id, trace, policy)
    if outbound.blocked_reason is not None:
        blocked = StageOutcome(trace=trace, blocked_reason=outbound.blocked_reason)
        refusal = _blocked(rpc_id, message, "output", blocked, policy, role)
        return GuardedReply(refusal, trace=trace)
    a2a.add_hub_metadata(result, _hub(policy, role, trace))
    return GuardedReply(reply, trace=trace)
