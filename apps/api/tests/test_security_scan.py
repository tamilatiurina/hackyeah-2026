"""SEC-01: the OWASP LLM Top 10 scan. The upstream is the real apps/test-agent, reached in-process;
it echoes anything it doesn't know ("Echo: …"), so canary probes always land without a hub."""

import asyncio
import json
import sys
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from app.api.routes.agents.deps import AgentDatabase, ResolvedUpstream, get_agent_database
from app.bindings.models import EffectivePolicy
from app.gateway import service as gateway_service
from app.gateway.pipeline import LocalEngine
from app.gateway.resolver import UpstreamTarget
from app.guardrails.judge import JudgeVerdict, get_judge
from app.main import app
from app.security.grade import NEEDS_JUDGE, Outcome, evidence, grade
from app.security.probes import PROBES, Probe
from app.security.runner import OUT_OF_TIME, run_scan, static_checks
from fastapi.testclient import TestClient
from pydantic import HttpUrl
from tests import fakes

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "test-agent" / "src"))
from acme_test_agent.app import create_app as create_test_agent  # noqa: E402

client = TestClient(app)

AGENT_ID = "7b4eb987-4315-4745-83c7-258061f2f2c4"
OWNER_ID = "971f4031-2dd9-4327-94c7-45323de61c67"
BASE_URL = "https://agent.example.com"
AGENT_ROW = {
    "upstream_url": f"{BASE_URL}/a2a",
    "auth_header_name": "Authorization",
    "auth_header_value": "Bearer agent-secret",
}
TARGET = UpstreamTarget(**AGENT_ROW)  # type: ignore[arg-type]
BY_ID = {p.id: p for p in PROBES}


def transport() -> httpx.ASGITransport:
    return httpx.ASGITransport(
        app=create_test_agent(auth_value="Bearer agent-secret", public_url=BASE_URL)
    )


def database(rows: list[dict[str, Any]]) -> AgentDatabase:
    db = MagicMock()
    query = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    query.execute.return_value.data = rows
    return AgentDatabase(client=db, owner_id=OWNER_ID)


class FakeJudge:
    def __init__(self, flagged: bool) -> None:
        self.flagged = flagged
        self.criteria: list[str] = []

    def __call__(self, criteria: str, text: str) -> JudgeVerdict:
        self.criteria.append(criteria)
        return JudgeVerdict(flagged=self.flagged, reason="fake verdict")


@pytest.fixture(autouse=True)
def agent(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    async def allow(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original, host_header=original.netloc.decode("ascii"), sni_hostname=original.host
        )

    async def http() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=transport()) as c:
            yield c

    monkeypatch.setattr(gateway_service, "ensure_public_upstream", allow)
    app.dependency_overrides[gateway_service.get_gateway_http_client] = http
    app.dependency_overrides[get_agent_database] = lambda: database([AGENT_ROW])
    yield
    app.dependency_overrides.clear()


def scan() -> list[dict[str, Any]]:
    with client.stream("POST", f"/api/v1/agents/{AGENT_ID}/security-scans") as response:
        assert response.status_code == 200, response.read()
        assert response.headers["content-type"].startswith("application/x-ndjson")
        return [json.loads(line) for line in response.iter_lines() if line]


def results(events: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {e["result"]["probeId"]: e["result"] for e in events if e["type"] == "probe"}


def test_the_stream_starts_reports_each_probe_then_saves_a_summary() -> None:
    events = scan()
    assert events[0]["type"] == "start"
    assert events[0]["total"] == len(PROBES)
    assert [c["id"] for c in events[0]["categories"]][:3] == ["LLM01", "LLM02", "LLM03"]
    assert [e["type"] for e in events[1:-1]] == ["probe"] * len(PROBES)
    summary = events[-1]
    assert summary["type"] == "summary"
    saved = summary["scan"]
    assert saved["id"] == events[0]["scanId"]
    assert saved["summary"]["total"] == len(PROBES)
    assert [r["probeId"] for r in saved["results"]] == [p.id for p in PROBES]  # pack order
    assert saved["id"] in fakes.SCANS


def test_an_echoed_canary_is_vulnerable_and_the_injection_guardrail_stops_it() -> None:
    direct = results(scan())["llm01-direct"]
    assert direct["unguarded"]["verdict"] == "vulnerable"
    assert direct["unguarded"]["reason"] == "The attack's marker is in the reply"
    assert direct["guarded"] == {
        "verdict": "defended",
        "reason": "Blocked by Prompt injection detector",
        "evidence": "",
        "stoppedBy": "Prompt injection detector",
    }


def test_improper_output_handling_is_caught_by_its_detector() -> None:
    found = results(scan())
    assert found["llm05-script"]["unguarded"]["verdict"] == "vulnerable"
    assert found["llm05-image"]["unguarded"]["verdict"] == "vulnerable"


def test_judge_only_probes_are_inconclusive_without_a_judge() -> None:
    agency = results(scan())["llm06-delete"]
    assert agency["unguarded"] == {
        "verdict": "inconclusive",
        "reason": NEEDS_JUDGE,
        "evidence": agency["unguarded"]["evidence"],
        "stoppedBy": None,
    }


def test_a_judge_grades_what_detectors_cannot() -> None:
    judge = FakeJudge(flagged=True)
    app.dependency_overrides[get_judge] = lambda: judge
    agency = results(scan())["llm06-delete"]
    assert agency["unguarded"]["verdict"] == "vulnerable"
    assert agency["unguarded"]["reason"] == "Judge: fake verdict"
    assert any("on its own authority" in c for c in judge.criteria)


def test_history_lists_and_returns_saved_scans() -> None:
    scan_id = scan()[-1]["scan"]["id"]
    listed = client.get(f"/api/v1/agents/{AGENT_ID}/security-scans").json()
    assert [s["id"] for s in listed] == [scan_id]
    assert "results" not in listed[0]
    detail = client.get(f"/api/v1/security-scans/{scan_id}").json()
    assert detail["id"] == scan_id
    assert len(detail["results"]) == len(PROBES)


def test_another_owners_agent_is_a_404() -> None:
    app.dependency_overrides[get_agent_database] = lambda: database([])
    assert client.post(f"/api/v1/agents/{AGENT_ID}/security-scans").status_code == 404
    assert client.get(f"/api/v1/agents/{AGENT_ID}/security-scans").status_code == 404


def test_another_owners_scan_is_a_404() -> None:
    scan_id = scan()[-1]["scan"]["id"]
    app.dependency_overrides[get_agent_database] = lambda: database([])
    assert client.get(f"/api/v1/security-scans/{scan_id}").status_code == 404


def test_probes_left_when_the_budget_runs_out_are_inconclusive(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def allow(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original, host_header=original.netloc.decode("ascii"), sni_hostname=original.host
        )

    monkeypatch.setattr(gateway_service, "ensure_public_upstream", allow)
    slow = Probe("slow", "LLM10", "Slow agent", "#slow 5")
    policy = EffectivePolicy(
        agent_id=AGENT_ID, role=None, user_id=None, version="v", input=[], output=[]
    )

    async def collect() -> list[Any]:
        async with httpx.AsyncClient(transport=transport()) as http:
            return [
                r
                async for r in run_scan(
                    agent_id=AGENT_ID,
                    target=TARGET,
                    policy=policy,
                    engine=LocalEngine(),
                    client=http,
                    judge=None,
                    role=None,
                    canary="GH-TEST",
                    probes=[slow],
                    budget_seconds=0.2,
                )
            ]

    [late] = asyncio.run(collect())
    assert late.unguarded.verdict == late.guarded.verdict == "inconclusive"
    assert late.guarded.reason == OUT_OF_TIME


def test_grading_rules() -> None:
    probe = BY_ID["llm01-direct"]
    blocked = grade(probe, Outcome(status="blocked", stopped_by="Injection"), "GH-X", None)
    assert (blocked.verdict, blocked.stopped_by) == ("defended", "Injection")
    failed = grade(probe, Outcome(status="error", error="timeout"), "GH-X", None)
    assert (failed.verdict, failed.reason) == ("inconclusive", "timeout")
    clean = grade(probe, Outcome(status="answered", text="No."), "GH-X", None)
    assert clean.verdict == "defended"
    essay = BY_ID["llm10-essay"]
    long = grade(essay, Outcome(status="answered", text="x", output_tokens=5000), "GH-X", None)
    assert (long.verdict, long.reason) == ("vulnerable", "5000 output tokens")


def test_evidence_masks_pii_and_secrets_and_is_short() -> None:
    shown = evidence("Mail jan@example.com, key sk-abcdefghijklmnop1234 " + "x" * 400)
    assert "jan@example.com" not in shown and "[EMAIL]" in shown
    assert "sk-abcdefghijklmnop1234" not in shown and "[SECRET]" in shown
    assert shown.endswith("…") and len(shown) <= 301


def test_static_checks_cover_the_categories_chat_cannot_reach() -> None:
    checks = {(c.category, c.title): c.status for c in static_checks(TARGET)}
    assert checks[("LLM03", "Agent endpoint uses HTTPS")] == "passed"
    assert checks[("LLM03", "Hub authenticates to the agent")] == "passed"
    plain = static_checks(UpstreamTarget(upstream_url="http://agent.test/a2a"))
    assert {c.status for c in plain if c.category == "LLM03"} == {"warning"}
    assert {c.category for c in plain if c.status == "not_testable"} == {"LLM04", "LLM08"}
