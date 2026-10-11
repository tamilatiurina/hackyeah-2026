"""B-05: per-call limits (time, tokens, cost) and per-session caps on the guarded URL.

The upstream is the real apps/test-agent, reached in-process (#slow N waits, #long N answers with
N words). Audit goes to A-07's in-memory store.
"""

import json
import logging
import sys
import time
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from app.api.routes.agents.deps import ResolvedUpstream
from app.audit.recorder import get_audit_recorder
from app.bindings.models import EffectivePolicy
from app.bindings.resolve import resolve
from app.core.config import settings
from app.gateway import limits
from app.gateway import service as gateway_service
from app.gateway.policy import get_policy_loader
from app.gateway.resolver import UpstreamTarget, get_agent_resolver
from app.main import app
from fastapi.testclient import TestClient
from pydantic import HttpUrl
from tests.fakes import MEMORY, InMemoryAuditRecorder, store

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "test-agent" / "src"))
from acme_test_agent.app import create_app as create_test_agent  # noqa: E402

client = TestClient(app)

AGENT_ID = "7b4eb987-4315-4745-83c7-258061f2f2c4"
KEY = "gk_key"
BASE_URL = "https://agent.example.com"


class Resolver:
    def resolve(self, agent_id: str, key: str) -> UpstreamTarget | None:
        return UpstreamTarget(upstream_url=f"{BASE_URL}/a2a") if key == KEY else None

    def agent_card(self, agent_id: str) -> dict[str, Any] | None:
        return None


class StorePolicy:
    """The seeded catalog: its mandatory guardrails make every call guarded."""

    def load(self, agent_id: str, key: str, role: str | None = None) -> EffectivePolicy:
        guardrails, bindings = list(store.guardrails.values()), list(store.bindings.values())
        return resolve(guardrails, bindings, agent_id, role)


@pytest.fixture(autouse=True)
def gateway(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    async def allow(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original, host_header=original.netloc.decode("ascii"), sni_hostname=original.host
        )

    async def http() -> AsyncIterator[httpx.AsyncClient]:
        transport = httpx.ASGITransport(app=create_test_agent(public_url=BASE_URL))
        async with httpx.AsyncClient(transport=transport) as c:
            yield c

    monkeypatch.setattr(gateway_service, "ensure_public_upstream", allow)
    app.dependency_overrides[get_agent_resolver] = Resolver
    app.dependency_overrides[get_policy_loader] = StorePolicy
    app.dependency_overrides[get_audit_recorder] = InMemoryAuditRecorder
    app.dependency_overrides[gateway_service.get_gateway_http_client] = http
    yield
    app.dependency_overrides.clear()


def say(text: str, context_id: str | None = "ctx-1") -> dict[str, Any]:
    message: dict[str, Any] = {"messageId": "m", "role": "ROLE_USER", "parts": [{"text": text}]}
    if context_id is not None:
        message["contextId"] = context_id
    call = {"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {"message": message}}
    r = client.post(f"/a/{AGENT_ID}", json=call, headers={"X-API-Key": KEY})
    assert r.status_code == 200, r.text
    body: dict[str, Any] = r.json()
    return body


def hub_of(body: dict[str, Any]) -> dict[str, Any]:
    result = body["result"]
    holder = result["message"] if "message" in result else result["task"]
    hub: dict[str, Any] = holder["metadata"]["agentsOnRails"]
    return hub


# --- AC: a slow upstream is cut at the timeout, and the cut is logged ------------------------


def test_slow_agent_is_cut_at_the_time_limit_and_the_cut_is_logged(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(settings, "CALL_TIMEOUT_SECONDS", 0.3)

    started = time.perf_counter()
    with caplog.at_level(logging.WARNING, logger="app.gateway.service"):
        body = say("#slow 30")
    elapsed = time.perf_counter() - started

    assert elapsed < 5  # cut, not waited out
    assert body["error"] == {
        "code": -32603,
        "message": "Upstream agent did not answer in time",
        "data": {"reason": "timeout"},
    }
    assert "time limit" in caplog.text  # the cut is logged...
    [event] = MEMORY.events  # ...and audited
    assert (event.kind, event.rule_id, event.action) == ("limit", "callTimeout", "block")
    assert event.details == "Agent did not answer within 0.3s (context ctx-1)"
    assert MEMORY.sessions.get((AGENT_ID, "ctx-1")) is None  # the conversation stays open


# --- AC: token and cost figures appear in the trace ------------------------------------------


def test_token_and_cost_figures_are_in_the_reply() -> None:
    hub = hub_of(say("hello"))

    # the test agent reports its usage: 2 tokens in ("hello"), 3 out ("Echo: hello")
    assert hub["usage"] == {
        "inputTokens": 2,
        "outputTokens": 3,
        "costUsd": 0.000051,  # 2 x 3 + 3 x 15 USD per million (the default price)
        "model": "default",
        "estimated": False,
    }
    assert {m["name"]: (m["used"], m["max"], m["unit"]) for m in hub["limits"]} == {
        "Tokens per call": (5, 8000, "tokens"),
        "Cost per call": (0.000051, 0.05, "USD"),
        "Session tokens": (5, 50000, "tokens"),
        "Session cost": (0.000051, 0.5, "USD"),
    }
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.input_tokens, session.output_tokens) == (2, 3)
    assert session.cost_usd == pytest.approx(0.000051)


def test_without_agent_usage_tokens_are_estimated_from_the_text() -> None:
    usage = limits.call_usage(
        {"parts": [{"text": "x" * 40}]},
        {"result": {"message": {"parts": [{"text": "y" * 8}]}}},
    )
    assert (usage.input_tokens, usage.output_tokens, usage.estimated) == (10, 2, True)


def test_cost_uses_the_price_of_the_reported_model() -> None:
    reply = {"result": {"message": {"parts": [], "metadata": {"model": "mock"}}}}
    assert limits.call_usage({"parts": [{"text": "hi"}]}, reply).cost_usd == 0.0
    assert limits.price("unknown-model", 1_000_000, 0) == 3.0  # falls back to "default"


# --- each limit blocks or warns ----------------------------------------------------------------


def test_a_blocking_token_cap_withholds_the_reply(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MAX_CALL_TOKENS", 50)

    body = say("#long 200")

    task = body["result"]["task"]
    assert task["status"]["state"] == "TASK_STATE_REJECTED"
    reason = task["status"]["message"]["parts"][0]["text"]
    assert reason.startswith('Blocked by limit "Tokens per call: used')
    assert "word199" not in json.dumps(body)  # the long reply never reaches the caller
    hub = task["metadata"]["agentsOnRails"]
    assert hub["blocked"] is True and hub["usage"]["outputTokens"] > 50
    [event] = MEMORY.events
    assert (event.rule_id, event.action, event.context_id) == ("maxCallTokens", "block", None)
    assert "(context ctx-1)" in event.details
    assert MEMORY.sessions[(AGENT_ID, "ctx-1")].stopped_at is None  # a call cap keeps it open


def test_a_warning_cap_lets_the_reply_through(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MAX_CALL_TOKENS", 50)
    monkeypatch.setattr(settings, "CALL_TOKENS_ACTION", "warn")

    body = say("#long 200")

    assert "word199" in body["result"]["message"]["parts"][0]["text"]
    [event] = MEMORY.events
    assert (event.rule_id, event.action) == ("maxCallTokens", "warn")


def test_a_session_cap_stops_the_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "MAX_SESSION_TOKENS", 12)

    assert "message" in say("hello")["result"]  # 5 tokens so far
    assert "message" in say("hello")["result"]  # 10
    third = say("hello")  # 15 > 12

    assert third["result"]["task"]["status"]["state"] == "TASK_STATE_REJECTED"
    [event] = MEMORY.events
    assert (event.rule_id, event.action, event.context_id) == ("maxSessionTokens", "block", "ctx-1")
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert session.stopped_at is not None
    assert session.stop_reason == "Session tokens: used 15 of 12 tokens"


def test_a_cap_of_zero_is_off(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in (
        "MAX_CALL_TOKENS",
        "MAX_CALL_COST_USD",
        "MAX_SESSION_TOKENS",
        "MAX_SESSION_COST_USD",
    ):
        monkeypatch.setattr(settings, name, 0)
    assert hub_of(say("#long 2000"))["limits"] == []
    assert MEMORY.events == []


def test_session_meters_in_the_sessions_api() -> None:
    say("hello")
    [session] = client.get("/api/v1/sessions").json()["data"]
    assert [(m["name"], m["used"]) for m in session["limits"]] == [
        ("Session tokens", 5.0),
        ("Session cost", 0.000051),
    ]
