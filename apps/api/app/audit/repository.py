"""A-07 read side: audit events, the rules seen in them, and sessions.

Same pattern as app/mcp/repository.py: Supabase with the signed-in user's token (RLS shows only
the caller's agents), or memory without Supabase (no owners there: everything is visible).
"""

from collections import Counter
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any, Protocol, TypeVar
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.audit import cursor
from app.audit.memory import MEMORY
from app.audit.models import (
    AuditEvent,
    AuditEventPage,
    AuditRule,
    EventFilters,
    SessionCounters,
    SessionFilters,
    SessionPage,
    to_session,
)
from app.core.config import settings
from app.core.supabase import get_supabase_for_user
from supabase import Client

T = TypeVar("T")
_bearer = HTTPBearer(auto_error=False)

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


def event_cursor(event: AuditEvent) -> str:
    return cursor.encode([event.at.isoformat(), event.id])


def _sorted_rules(rules: dict[str, AuditRule]) -> list[AuditRule]:
    return sorted(rules.values(), key=lambda r: (r.kind != "guardrail", r.rule_name.lower()))


class InMemoryAuditRepository:
    def events(self, filters: EventFilters) -> AuditEventPage:
        rows = [
            e
            for e in reversed(MEMORY.events)
            if (filters.agent_id is None or e.agent_id == filters.agent_id)
            and (filters.rule_id is None or e.rule_id == filters.rule_id)
            and (filters.action is None or e.action == filters.action)
            and (filters.kind is None or e.kind == filters.kind)
            and (filters.context_id is None or e.context_id == filters.context_id)
        ]
        if filters.before is not None:
            ids = [e.id for e in rows]
            _, last_id = filters.before
            rows = rows[ids.index(last_id) + 1 :] if last_id in ids else []
        page = rows[: filters.limit]
        more = len(rows) > filters.limit
        return AuditEventPage(data=page, next_cursor=event_cursor(page[-1]) if more else None)

    def rules(self) -> list[AuditRule]:
        seen = {
            e.rule_id: AuditRule(rule_id=e.rule_id, rule_name=e.rule_name, kind=e.kind)
            for e in MEMORY.events
        }
        return _sorted_rules(seen)

    def sessions(self, filters: SessionFilters) -> SessionPage:
        counts = Counter((e.agent_id, e.context_id) for e in MEMORY.events)
        rows = sorted(MEMORY.sessions.values(), key=lambda s: s.last_at, reverse=True)
        rows = [
            s
            for s in rows
            if (filters.agent_id is None or s.agent_id == filters.agent_id)
            and (
                filters.status is None
                or (s.stopped_at is not None) == (filters.status == "stopped")
            )
        ]
        page = rows[filters.offset : filters.offset + filters.limit]
        end = filters.offset + len(page)
        return SessionPage(
            data=[to_session(s, None, counts[(s.agent_id, s.context_id)]) for s in page],
            next_cursor=cursor.encode([str(end)]) if end < len(rows) else None,
        )


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
        return _sorted_rules(seen)

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
            to_session(
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


def get_audit_repository(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuditRepository:
    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        return InMemoryAuditRepository()
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to see the audit log",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return SupabaseAuditRepository(get_supabase_for_user(credentials.credentials))


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
