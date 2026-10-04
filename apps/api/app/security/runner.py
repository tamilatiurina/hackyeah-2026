"""Run the attack pack against one agent, straight and through the hub, and yield graded results."""

import asyncio
import json
from collections.abc import AsyncIterator
from uuid import uuid4

import httpx
from fastapi.concurrency import run_in_threadpool

from app.audit.recorder import NullAuditRecorder
from app.bindings.models import EffectivePolicy
from app.gateway import a2a, limits
from app.gateway.pipeline import GuardrailEngine
from app.gateway.resolver import UpstreamTarget
from app.gateway.service import Audit, GuardedReply, UpstreamError, post_upstream, send_guarded
from app.guardrails.judge import Judge
from app.security.grade import Outcome, grade
from app.security.models import (
    ProbeResult,
    RunResult,
    RunTotals,
    ScanSummary,
    StaticCheck,
)
from app.security.probes import PROBES, Probe

SCAN_BUDGET_SECONDS = 240.0  # under Vercel's 300 s function limit
CONCURRENCY = 4
OUT_OF_TIME = "The scan ran out of time before this probe finished"


def static_checks(target: UpstreamTarget) -> list[StaticCheck]:
    """The categories that can't be attacked over chat."""
    https = target.upstream_url.lower().startswith("https://")
    auth = bool(target.auth_header_name and target.auth_header_value)
    return [
        StaticCheck(
            category="LLM03",
            title="Agent endpoint uses HTTPS",
            status="passed" if https else "warning",
            detail=target.upstream_url,
        ),
        StaticCheck(
            category="LLM03",
            title="Hub authenticates to the agent",
            status="passed" if auth else "warning",
            detail="An auth header is configured" if auth else "No auth header: anyone can call it",
        ),
        StaticCheck(
            category="LLM04",
            title="Training and fine-tuning data",
            status="not_testable",
            detail="Poisoning happens before deployment; it can't be probed over chat.",
        ),
        StaticCheck(
            category="LLM08",
            title="Vector store and embeddings",
            status="not_testable",
            detail="The hub doesn't see the agent's retrieval layer.",
        ),
    ]


def _call(text: str) -> a2a.Json:
    message_id = str(uuid4())
    return {
        "jsonrpc": a2a.JSONRPC_VERSION,
        "id": f"scan-{message_id}",
        "method": "SendMessage",
        "params": {
            "message": {
                "messageId": message_id,
                "contextId": f"ctx-scan-{uuid4()}",  # one per call: no shared session caps
                "role": "ROLE_USER",
                "parts": [{"text": text}],
            }
        },
    }


def _reply_text(result: a2a.Json) -> str:
    text, _ = a2a.checked_text(a2a.reply_holders(result))
    return text


async def call_unguarded(client: httpx.AsyncClient, target: UpstreamTarget, text: str) -> Outcome:
    """Straight to the agent: no guardrails, no hub limits (the baseline)."""
    headers = {"Content-Type": "application/json", a2a.A2A_VERSION_HEADER: a2a.A2A_VERSION}
    if target.auth_header_name and target.auth_header_value:
        headers[target.auth_header_name] = target.auth_header_value
    try:
        response = await post_upstream(
            client, target.upstream_url, headers, json.dumps(_call(text)).encode()
        )
        reply = response.json()
    except UpstreamError as error:
        return Outcome(status="error", error=f"The agent couldn't be reached ({error})")
    except ValueError:
        return Outcome(status="error", error="The agent answered without JSON")
    result = reply.get("result") if isinstance(reply, dict) else None
    if not isinstance(result, dict):
        return Outcome(status="error", error="The agent answered with a JSON-RPC error")
    answer = _reply_text(result)
    _, output_tokens = a2a.usage_tokens(reply)
    return Outcome(
        status="answered",
        text=answer,
        output_tokens=output_tokens or limits.estimate_tokens(answer),
    )


def _hub_metadata(result: a2a.Json) -> a2a.Json:
    """metadata.guardrailHub on the reply message or task ({} when absent)."""
    for holder in (result.get("message"), result.get("task")):
        if isinstance(holder, dict):
            hub = (holder.get("metadata") or {}).get(a2a.METADATA_KEY)
            if isinstance(hub, dict):
                return hub
    return {}


def _guarded_outcome(reply: GuardedReply) -> Outcome:
    result = reply.body.get("result")
    if not isinstance(result, dict):
        error = reply.body.get("error") or {}
        message = error.get("message") if isinstance(error, dict) else None
        return Outcome(status="error", error=str(message or "The call failed"))
    if _hub_metadata(result).get("blocked"):
        blocker = next((e.guardrail_name for e in reply.trace if e.verdict == "block"), None)
        if blocker is None:  # a limit, not a guardrail: its reason is the refusal text
            blocker = _reply_text(result).removeprefix("Blocked by ").strip() or "a hub limit"
        return Outcome(status="blocked", stopped_by=blocker)
    answer = _reply_text(result)
    redacted = [e.guardrail_name for e in reply.trace if e.verdict == "redact"]
    output_tokens = reply.usage.output_tokens if reply.usage else limits.estimate_tokens(answer)
    return Outcome(
        status="answered",
        text=answer,
        output_tokens=output_tokens,
        stopped_by=", ".join(redacted) or None,
    )


async def call_guarded(
    client: httpx.AsyncClient,
    target: UpstreamTarget,
    text: str,
    *,
    agent_id: str,
    policy: EffectivePolicy,
    engine: GuardrailEngine,
    role: str | None,
) -> Outcome:
    """Through the agent's effective guardrails and the hub's limits, like the test chat."""
    reply = await send_guarded(
        _call(text),
        target=target,
        policy=policy,
        engine=engine,
        client=client,
        audit=Audit(recorder=NullAuditRecorder(), agent_id=agent_id),
        role=role,
    )
    return _guarded_outcome(reply)


def _out_of_time(probe: Probe, canary: str) -> ProbeResult:
    late = RunResult(verdict="inconclusive", reason=OUT_OF_TIME)
    return ProbeResult(
        probe_id=probe.id,
        category=probe.category,
        title=probe.title,
        attack=probe.attack(canary),
        unguarded=late,
        guarded=late,
    )


async def run_scan(
    *,
    agent_id: str,
    target: UpstreamTarget,
    policy: EffectivePolicy,
    engine: GuardrailEngine,
    client: httpx.AsyncClient,
    judge: Judge | None,
    role: str | None,
    canary: str,
    probes: list[Probe] = PROBES,
    budget_seconds: float = SCAN_BUDGET_SECONDS,
) -> AsyncIterator[ProbeResult]:
    """Yields each probe's result as it finishes; the order is not the pack's order."""
    slots = asyncio.Semaphore(CONCURRENCY)

    async def unguarded(text: str) -> Outcome:
        async with slots:
            return await call_unguarded(client, target, text)

    async def guarded(text: str) -> Outcome:
        async with slots:
            try:
                return await call_guarded(
                    client, target, text, agent_id=agent_id, policy=policy, engine=engine, role=role
                )
            except Exception as error:  # noqa: BLE001 - one broken call must not end the scan
                return Outcome(status="error", error=f"The hub failed ({type(error).__name__})")

    async def run(probe: Probe) -> ProbeResult:
        attack = probe.attack(canary)
        plain, hub = await asyncio.gather(unguarded(attack), guarded(attack))
        return ProbeResult(
            probe_id=probe.id,
            category=probe.category,
            title=probe.title,
            attack=attack,
            unguarded=await run_in_threadpool(grade, probe, plain, canary, judge),
            guarded=await run_in_threadpool(grade, probe, hub, canary, judge),
        )

    loop = asyncio.get_running_loop()
    deadline = loop.time() + budget_seconds
    tasks = {asyncio.create_task(run(p)): p for p in probes}
    pending = set(tasks)
    try:
        while pending:
            remaining = deadline - loop.time()
            if remaining <= 0:
                break
            done, pending = await asyncio.wait(
                pending, timeout=remaining, return_when=asyncio.FIRST_COMPLETED
            )
            for task in done:
                yield task.result()
        for task in pending:
            yield _out_of_time(tasks[task], canary)
    finally:
        for task in pending:  # out of time, or the caller went away
            task.cancel()


def summarize(results: list[ProbeResult]) -> ScanSummary:
    def totals(kind: str) -> RunTotals:
        out = RunTotals()
        for r in results:
            verdict = getattr(r, kind).verdict
            setattr(out, verdict, getattr(out, verdict) + 1)
        return out

    return ScanSummary(
        total=len(results),
        unguarded=totals("unguarded"),
        guarded=totals("guarded"),
        stopped=sum(
            r.unguarded.verdict == "vulnerable" and r.guarded.verdict == "defended" for r in results
        ),
    )
