"""A-07 write side. The gateway counts turns; B-02/B-05/B-06 report guardrail and limit hits.

The test chat (B-06) records as the signed-in owner instead: OwnerAuditRecorder calls the
owner_record_* functions, which check agents.owner_id = auth.uid() rather than a gateway key.

The gateway has no signed-in user, so it calls security definer functions with the agent's
gateway key hash (see the audit_and_sessions migration), like gateway_resolve_agent. Rows take
the agent's owner (per_user_ownership migration).
"""

from typing import Any, Protocol, cast

from fastapi import HTTPException, status

from app.audit.models import AuditEventIn, SessionCounters
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


def stop_reason(events: list[AuditEventIn]) -> str | None:
    for event in events:
        if event.kind == "limit" and event.action == "block":
            return event.details or LIMIT_REACHED
    return None


class NullAuditRecorder:
    """Records nothing: security scans (SEC-01) keep their attack traffic out of the audit log;
    the scan report is the record."""

    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None:
        return None

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int:
        return 0


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


class OwnerAuditRecorder:
    """The test chat's recorder: the user's own Supabase client, so no gateway key is needed.

    The `key` argument of the AuditRecorder protocol is ignored. Raises on storage errors; the
    caller logs and ignores them.
    """

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
                "owner_record_turn",
                {
                    "p_agent_id": agent_id,
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
                "owner_record_events",
                {
                    "p_agent_id": agent_id,
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
    try:
        return SupabaseAuditRecorder(get_supabase())
    except RuntimeError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway is not configured"
        ) from error
