"""A-07 write side. The gateway counts turns; B-02/B-05/B-06 report guardrail and limit hits.

Supabase: the gateway has no signed-in user, so it calls security definer functions with the
agent's gateway key hash (see the audit_and_sessions migration), like gateway_resolve_agent.
In memory (no Supabase): the caller already checked the key, so it isn't checked again.
"""

from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import uuid4

from app.audit.memory import MEMORY
from app.audit.models import AuditEvent, AuditEventIn, SessionCounters
from app.core.config import settings
from app.core.supabase import get_supabase
from app.gateway.keys import hash_key
from supabase import Client

LIMIT_REACHED = "Limit reached"


class AuditRecorder(Protocol):
    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None: ...

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int: ...


def _stop_reason(events: list[AuditEventIn]) -> str | None:
    for event in events:
        if event.kind == "limit" and event.action == "block":
            return event.details or LIMIT_REACHED
    return None


class InMemoryAuditRecorder:
    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None:
        now = datetime.now(UTC)
        current = MEMORY.sessions.get((agent_id, context_id))
        if current is None:
            current = SessionCounters(
                agent_id=agent_id,
                context_id=context_id,
                turns=0,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                started_at=now,
                last_at=now,
            )
        updated = current.model_copy(
            update={
                "turns": current.turns + 1,
                "input_tokens": current.input_tokens + max(input_tokens, 0),
                "output_tokens": current.output_tokens + max(output_tokens, 0),
                "cost_usd": current.cost_usd + max(cost_usd, 0.0),
                "last_at": now,
            }
        )
        MEMORY.sessions[(agent_id, context_id)] = updated
        return updated

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int:
        now = datetime.now(UTC)
        for event in events:
            MEMORY.events.append(
                AuditEvent(
                    **event.model_dump(),
                    id=str(uuid4()),
                    at=now,
                    agent_id=agent_id,
                    context_id=context_id,
                )
            )
        reason = _stop_reason(events)
        if reason and context_id is not None:
            current = MEMORY.sessions.get((agent_id, context_id)) or SessionCounters(
                agent_id=agent_id,
                context_id=context_id,
                turns=0,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                started_at=now,
                last_at=now,
            )
            MEMORY.sessions[(agent_id, context_id)] = current.model_copy(
                update={
                    "stopped_at": current.stopped_at or now,
                    "stop_reason": current.stop_reason or reason,
                    "last_at": now,
                }
            )
        return len(events)


class SupabaseAuditRecorder:
    """Raises on storage errors; the gateway logs and ignores them."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None:
        data = (
            self._client.rpc(
                "gateway_record_turn",
                {
                    "p_agent_id": agent_id,
                    "p_key_hash": hash_key(key),
                    "p_context_id": context_id,
                    "p_input_tokens": input_tokens,
                    "p_output_tokens": output_tokens,
                    "p_cost_usd": cost_usd,
                },
            )
            .execute()
            .data
        )
        rows = cast(list[dict[str, Any]], data or [])
        return SessionCounters.model_validate(rows[0]) if rows else None

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int:
        if not events:
            return 0
        data = (
            self._client.rpc(
                "gateway_record_events",
                {
                    "p_agent_id": agent_id,
                    "p_key_hash": hash_key(key),
                    "p_context_id": context_id,
                    "p_events": [event.model_dump() for event in events],
                },
            )
            .execute()
            .data
        )
        return data if isinstance(data, int) else 0


def get_audit_recorder() -> AuditRecorder:
    """FastAPI dependency for the gateway."""
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        return SupabaseAuditRecorder(get_supabase())
    return InMemoryAuditRecorder()
