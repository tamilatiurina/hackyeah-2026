"""A-07 read side: audit events, the rules seen in them, and sessions.

Same pattern as app/mcp/repository.py: Supabase with the signed-in user's token, so RLS shows
only the caller's own events and sessions.
"""

from collections import Counter
from collections.abc import Callable
from datetime import datetime
from typing import Any, Protocol, TypeVar
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.audit import cursor
from app.audit.models import (
    AuditEvent,
    AuditEventPage,
    AuditRule,
    EventFilters,
    Session,
    SessionCounters,
    SessionFilters,
    SessionPage,
    to_session,
)
from app.core.auth import Me
from supabase import Client

T = TypeVar("T")

_EVENT_COLUMNS = (
    "id,at,agent_id,context_id,rule_id,rule_name,kind,stage,action,config_version,details,"
    "agents(name)"
)
_SESSION_COLUMNS = (
    "agent_id,context_id,turns,input_tokens,output_tokens,cost_usd,started_at,last_at,"
    "stopped_at,stop_reason,agents(name)"
)
_RULES_SCAN = 1000  # distinct rules are read from the newest events; plenty for a demo


class AuditRepository(Protocol):
    def events(self, filters: EventFilters) -> AuditEventPage: ...

    def rules(self) -> list[AuditRule]: ...

    def sessions(self, filters: SessionFilters) -> SessionPage: ...


def with_limits(counters: SessionCounters, agent_name: str | None, events: int) -> Session:
    """A session with its B-05 limit meters (the session caps and how much of them it used)."""
    from app.gateway.limits import session_limits  # app.gateway imports app.audit

    session = to_session(counters, agent_name, events)
    return session.model_copy(update={"limits": session_limits(counters)})


def event_cursor(event: AuditEvent) -> str:
    return cursor.encode([event.at.isoformat(), event.id])


def sorted_rules(rules: dict[str, AuditRule]) -> list[AuditRule]:
    return sorted(rules.values(), key=lambda r: (r.kind != "guardrail", r.rule_name.lower()))


def _agent_name(row: dict[str, Any]) -> str | None:
    agent = row.get("agents")
    return agent.get("name") if isinstance(agent, dict) else None


class SupabaseAuditRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    def _run(self, query: Callable[[], T]) -> T:
        try:
            return query()
        except APIError as error:
            if (error.code or "").startswith("PGRST3"):
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token"
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Audit storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Audit storage is unavailable"
            ) from error

    def events(self, filters: EventFilters) -> AuditEventPage:
        query = self._client.table("audit_events").select(_EVENT_COLUMNS)
        for column, value in (
            ("agent_id", filters.agent_id),
            ("rule_id", filters.rule_id),
            ("action", filters.action),
            ("kind", filters.kind),
            ("context_id", filters.context_id),
        ):
            if value is not None:
                query = query.eq(column, value)
        if filters.before is not None:
            at, last_id = filters.before
            stamp = at.isoformat()  # both values come from a decoded cursor: a timestamp and a uuid
            query = query.or_(f"at.lt.{stamp},and(at.eq.{stamp},id.lt.{last_id})")
        response = self._run(
            lambda: (
                query.order("at", desc=True)
                .order("id", desc=True)
                .limit(filters.limit + 1)
                .execute()
            )
        )
        rows = list(response.data)
        try:
            page = [
                AuditEvent.model_validate({**row, "agent_name": _agent_name(row)})
                for row in rows[: filters.limit]
            ]
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Stored audit event is invalid"
            ) from error
        more = len(rows) > filters.limit
        return AuditEventPage(data=page, next_cursor=event_cursor(page[-1]) if more else None)

    def rules(self) -> list[AuditRule]:
        response = self._run(
            lambda: (
                self._client.table("audit_events")
                .select("rule_id,rule_name,kind")
                .order("at", desc=True)
                .limit(_RULES_SCAN)
                .execute()
            )
        )
        seen: dict[str, AuditRule] = {}
        for row in response.data:
            seen.setdefault(row["rule_id"], AuditRule.model_validate(row))
        return sorted_rules(seen)

    def sessions(self, filters: SessionFilters) -> SessionPage:
        query = self._client.table("agent_sessions").select(_SESSION_COLUMNS)
        if filters.agent_id is not None:
            query = query.eq("agent_id", filters.agent_id)
        if filters.status == "active":
            query = query.is_("stopped_at", "null")
        elif filters.status == "stopped":
            query = query.not_.is_("stopped_at", "null")
        response = self._run(
            lambda: (
                query.order("last_at", desc=True)
                .range(filters.offset, filters.offset + filters.limit)  # inclusive: one extra row
                .execute()
            )
        )
        rows = list(response.data)
        page_rows = rows[: filters.limit]
        counts: Counter[tuple[str, str]] = Counter()
        context_ids = sorted({row["context_id"] for row in page_rows})
        if context_ids:
            found = self._run(
                lambda: (
                    self._client.table("audit_events")
                    .select("agent_id,context_id")
                    .in_("context_id", context_ids)
                    .execute()
                )
            )
            counts = Counter((e["agent_id"], e["context_id"]) for e in found.data)
        sessions = [
            with_limits(
                SessionCounters.model_validate(row),
                _agent_name(row),
                counts[(row["agent_id"], row["context_id"])],
            )
            for row in page_rows
        ]
        end = filters.offset + len(page_rows)
        return SessionPage(
            data=sessions,
            next_cursor=cursor.encode([str(end)]) if len(rows) > filters.limit else None,
        )


def get_audit_repository(user: Me) -> AuditRepository:
    """FastAPI dependency: the signed-in user's audit log and sessions."""
    return SupabaseAuditRepository(user.client)


def parse_event_cursor(before: str | None) -> tuple[datetime, str] | None:
    if before is None:
        return None
    at, event_id = cursor.decode(before, 2)
    # Both parts end up in a PostgREST filter, so only a real timestamp and uuid get through.
    return datetime.fromisoformat(at), str(UUID(event_id))


def parse_session_cursor(before: str | None) -> int:
    if before is None:
        return 0
    (offset,) = cursor.decode(before, 1)
    value = int(offset)
    if value < 0:
        raise ValueError("Invalid cursor")
    return value
