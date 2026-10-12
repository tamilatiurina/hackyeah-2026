"""A-07 write side: counting turns and storing audit events (in memory; SQL in the migration)."""

from unittest.mock import MagicMock

from app.audit.models import AuditEventIn
from app.audit.recorder import SupabaseAuditRecorder
from app.gateway.keys import hash_key
from tests.fakes import MEMORY, InMemoryAuditRecorder

AGENT = "7b4eb987-4315-4745-83c7-258061f2f2c4"


def pii(action: str = "redact") -> AuditEventIn:
    return AuditEventIn(
        rule_id="g-pii",
        rule_name="PII",
        kind="guardrail",
        stage="output",
        action=action,
        details="email address",
    )


def session_cap() -> AuditEventIn:
    return AuditEventIn(
        rule_id="maxSessionTokens",
        rule_name="Session tokens",
        kind="limit",
        action="block",
        details="Session token cap reached",
    )


def test_first_turn_creates_the_session_and_later_turns_add_up() -> None:
    recorder = InMemoryAuditRecorder()
    first = recorder.record_turn(AGENT, "key", "ctx-1", 10, 4, 0.0)
    second = recorder.record_turn(AGENT, "key", "ctx-1", 5, 1, 0.0)
    assert first is not None and first.turns == 1
    assert second is not None
    assert (second.turns, second.input_tokens, second.output_tokens) == (2, 15, 5)
    assert second.last_at >= first.started_at
    assert second.stopped_at is None


def test_negative_tokens_count_as_zero() -> None:
    counters = InMemoryAuditRecorder().record_turn(AGENT, "key", "ctx-1", -3, -1, -0.5)
    assert counters is not None
    assert (counters.input_tokens, counters.output_tokens, counters.cost_usd) == (0, 0, 0.0)


def test_events_are_stored_newest_last() -> None:
    stored = InMemoryAuditRecorder().record_events(AGENT, "key", "ctx-1", [pii(), pii("warn")])
    assert stored == 2
    assert [e.action for e in MEMORY.events] == ["redact", "warn"]
    assert all(e.agent_id == AGENT and e.context_id == "ctx-1" for e in MEMORY.events)


def test_a_limit_block_stops_the_session_with_its_reason() -> None:
    recorder = InMemoryAuditRecorder()
    recorder.record_turn(AGENT, "key", "ctx-1", 1, 1, 0.0)
    recorder.record_events(AGENT, "key", "ctx-1", [session_cap()])
    session = MEMORY.sessions[(AGENT, "ctx-1")]
    assert session.stopped_at is not None
    assert session.stop_reason == "Session token cap reached"


def test_a_guardrail_block_or_a_limit_warning_does_not_stop_the_session() -> None:
    recorder = InMemoryAuditRecorder()
    recorder.record_turn(AGENT, "key", "ctx-1", 1, 1, 0.0)
    warn = session_cap().model_copy(update={"action": "warn"})
    recorder.record_events(AGENT, "key", "ctx-1", [pii("block"), warn])
    assert MEMORY.sessions[(AGENT, "ctx-1")].stopped_at is None


def test_supabase_recorder_sends_only_the_key_hash() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = [
        {
            "agent_id": AGENT,
            "context_id": "ctx-1",
            "turns": 1,
            "input_tokens": 3,
            "output_tokens": 2,
            "cost_usd": 0,
            "started_at": "2026-10-04T10:00:00+00:00",
            "last_at": "2026-10-04T10:00:00+00:00",
            "stopped_at": None,
            "stop_reason": None,
        }
    ]
    counters = SupabaseAuditRecorder(client).record_turn(AGENT, "secret-key", "ctx-1", 3, 2, 0.0)
    name, params = client.rpc.call_args.args
    assert name == "gateway_record_turn"
    assert params["p_key_hash"] == hash_key("secret-key")
    assert "secret-key" not in str(params)
    assert counters is not None and counters.turns == 1


def test_supabase_recorder_sends_events_as_json() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = 1
    assert SupabaseAuditRecorder(client).record_events(AGENT, "k", None, [pii()]) == 1
    name, params = client.rpc.call_args.args
    assert name == "gateway_record_events"
    assert params["p_events"][0]["rule_id"] == "g-pii"
    assert params["p_context_id"] is None
