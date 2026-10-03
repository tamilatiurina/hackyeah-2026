"""A-07 read API: audit events with filters and paging, rules, sessions."""

import pytest
from app.audit.models import AuditEventIn
from app.audit.recorder import InMemoryAuditRecorder
from app.core.config import settings
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
SUPPORT = "7b4eb987-4315-4745-83c7-258061f2f2c4"
CONTRACTS = "0b9a3a3e-8f39-4b55-9a5e-1d1c2b3a4f5e"


def hit(rule_id: str, action: str, kind: str = "guardrail") -> AuditEventIn:
    return AuditEventIn(
        rule_id=rule_id,
        rule_name=rule_id.upper(),
        kind=kind,
        action=action,
        stage="input" if kind == "guardrail" else None,
        details=f"{rule_id} {action}",
    )


@pytest.fixture
def events() -> None:
    r = InMemoryAuditRecorder()
    r.record_events(SUPPORT, "k", "ctx-a", [hit("pii", "redact")])
    r.record_events(SUPPORT, "k", "ctx-a", [hit("inject", "block")])
    r.record_events(CONTRACTS, "k", "ctx-b", [hit("pii", "block")])
    r.record_events(SUPPORT, "k", "ctx|odd,(id)", [hit("maxSessionTokens", "block", "limit")])
    r.record_events(SUPPORT, "k", None, [hit("pii", "warn")])


def test_events_newest_first(events: None) -> None:
    body = client.get("/api/v1/audit-events").json()
    assert [e["details"] for e in body["data"]] == [
        "pii warn",
        "maxSessionTokens block",
        "pii block",
        "inject block",
        "pii redact",
    ]
    assert body["next_cursor"] is None


def test_filters_combine(events: None) -> None:
    r = client.get(
        "/api/v1/audit-events", params={"agent_id": SUPPORT, "rule_id": "pii", "action": "redact"}
    )
    assert [e["details"] for e in r.json()["data"]] == ["pii redact"]
    r = client.get("/api/v1/audit-events", params={"kind": "limit"})
    assert [e["rule_id"] for e in r.json()["data"]] == ["maxSessionTokens"]
    r = client.get("/api/v1/audit-events", params={"context_id": "ctx|odd,(id)"})
    assert len(r.json()["data"]) == 1


def test_paging_with_the_cursor_has_no_overlap(events: None) -> None:
    first = client.get("/api/v1/audit-events", params={"limit": 2}).json()
    assert len(first["data"]) == 2 and first["next_cursor"]
    second = client.get(
        "/api/v1/audit-events", params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    third = client.get(
        "/api/v1/audit-events", params={"limit": 2, "before": second["next_cursor"]}
    ).json()
    ids = [e["id"] for page in (first, second, third) for e in page["data"]]
    assert len(ids) == 5 and len(set(ids)) == 5
    assert third["next_cursor"] is None


@pytest.mark.parametrize("before", ["garbage", "W10", "WyJ4Il0"])
def test_a_bad_cursor_is_422(before: str) -> None:
    assert client.get("/api/v1/audit-events", params={"before": before}).status_code == 422


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"action": "drop"}, {"kind": "x"}]
)
def test_bad_filters_are_422(params: dict[str, object]) -> None:
    assert client.get("/api/v1/audit-events", params=params).status_code == 422


def test_rules_are_distinct_and_grouped_by_kind(events: None) -> None:
    rules = client.get("/api/v1/audit-events/rules").json()
    assert rules == [
        {"rule_id": "inject", "rule_name": "INJECT", "kind": "guardrail"},
        {"rule_id": "pii", "rule_name": "PII", "kind": "guardrail"},
        {"rule_id": "maxSessionTokens", "rule_name": "MAXSESSIONTOKENS", "kind": "limit"},
    ]


def test_sessions_with_counters_status_and_event_count(events: None) -> None:
    r = InMemoryAuditRecorder()
    r.record_turn(SUPPORT, "k", "ctx-a", 10, 5, 0.0)
    r.record_turn(SUPPORT, "k", "ctx-a", 1, 1, 0.0)
    r.record_turn(CONTRACTS, "k", "ctx-b", 3, 3, 0.0)
    sessions = client.get("/api/v1/sessions").json()["data"]
    by_ctx = {s["context_id"]: s for s in sessions}
    assert by_ctx["ctx-a"]["turns"] == 2 and by_ctx["ctx-a"]["input_tokens"] == 11
    assert by_ctx["ctx-a"]["events"] == 2 and by_ctx["ctx-a"]["status"] == "active"
    assert by_ctx["ctx|odd,(id)"]["status"] == "stopped"
    assert by_ctx["ctx|odd,(id)"]["stop_reason"] == "maxSessionTokens block"
    assert by_ctx["ctx-a"]["limits"] == []
    assert sessions[0]["context_id"] == "ctx-b"  # most recent activity first


def test_session_filters_and_paging(events: None) -> None:
    r = InMemoryAuditRecorder()
    r.record_turn(SUPPORT, "k", "ctx-a", 1, 1, 0.0)
    r.record_turn(CONTRACTS, "k", "ctx-b", 1, 1, 0.0)
    stopped = client.get("/api/v1/sessions", params={"status": "stopped"}).json()["data"]
    assert [s["context_id"] for s in stopped] == ["ctx|odd,(id)"]
    mine = client.get("/api/v1/sessions", params={"agent_id": CONTRACTS}).json()["data"]
    assert [s["context_id"] for s in mine] == ["ctx-b"]
    first = client.get("/api/v1/sessions", params={"limit": 2}).json()
    rest = client.get(
        "/api/v1/sessions", params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    assert len(first["data"]) == 2 and len(rest["data"]) == 1 and rest["next_cursor"] is None


def test_needs_a_token_with_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "publishable")
    for path in ("/api/v1/audit-events", "/api/v1/audit-events/rules", "/api/v1/sessions"):
        assert client.get(path).status_code == 401
