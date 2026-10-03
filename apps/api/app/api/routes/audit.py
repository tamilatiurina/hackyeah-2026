"""A-07: audit events (FR-28) and sessions (FR-36), read by the panel."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.audit.models import (
    Action,
    AuditEventPage,
    AuditRule,
    EventFilters,
    Kind,
    SessionFilters,
    SessionPage,
    SessionStatus,
)
from app.audit.repository import (
    AuditRepository,
    get_audit_repository,
    parse_event_cursor,
    parse_session_cursor,
)

router = APIRouter(tags=["audit"])
Repo = Annotated[AuditRepository, Depends(get_audit_repository)]
Limit = Annotated[int, Query(ge=1, le=200)]


def _bad_cursor() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid cursor")


@router.get("/audit-events")
def list_audit_events(
    repo: Repo,
    agent_id: UUID | None = None,
    rule_id: str | None = None,
    action: Action | None = None,
    kind: Kind | None = None,
    context_id: str | None = None,
    limit: Limit = 50,
    before: str | None = None,
) -> AuditEventPage:
    try:
        cursor = parse_event_cursor(before)
    except ValueError as error:
        raise _bad_cursor() from error
    return repo.events(
        EventFilters(
            agent_id=str(agent_id) if agent_id else None,
            rule_id=rule_id,
            action=action,
            kind=kind,
            context_id=context_id,
            limit=limit,
            before=cursor,
        )
    )


@router.get("/audit-events/rules")
def list_audit_rules(repo: Repo) -> list[AuditRule]:
    return repo.rules()


@router.get("/sessions")
def list_sessions(
    repo: Repo,
    agent_id: UUID | None = None,
    status_: Annotated[SessionStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    before: str | None = None,
) -> SessionPage:
    try:
        offset = parse_session_cursor(before)
    except ValueError as error:
        raise _bad_cursor() from error
    return repo.sessions(
        SessionFilters(
            agent_id=str(agent_id) if agent_id else None, status=status_, limit=limit, offset=offset
        )
    )
