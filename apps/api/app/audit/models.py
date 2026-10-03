"""A-07 models: audit events (FR-28) and session counters (FR-36). No message content."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["guardrail", "limit"]
Stage = Literal["input", "output"]
Action = Literal["block", "redact", "warn"]
SessionStatus = Literal["active", "stopped"]


class AuditEventIn(BaseModel):
    """What a reporter (B-02 pipeline, B-05 limits, B-06 test chat) sends for one hit."""

    rule_id: str = Field(min_length=1, max_length=200)
    rule_name: str = Field(min_length=1, max_length=200)
    kind: Kind
    stage: Stage | None = None
    action: Action
    config_version: str | None = None
    details: str = Field(default="", max_length=500)  # the reason, never message text


class AuditEvent(AuditEventIn):
    id: str
    at: datetime
    agent_id: str
    agent_name: str | None = None
    context_id: str | None = None


class AuditEventPage(BaseModel):
    data: list[AuditEvent]
    next_cursor: str | None


class AuditRule(BaseModel):
    rule_id: str
    rule_name: str
    kind: Kind


class SessionLimit(BaseModel):
    name: str
    used: float
    max: float
    unit: str | None = None


class SessionCounters(BaseModel):
    agent_id: str
    context_id: str
    turns: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    started_at: datetime
    last_at: datetime
    stopped_at: datetime | None = None
    stop_reason: str | None = None


class Session(BaseModel):
    agent_id: str
    agent_name: str | None = None
    context_id: str
    turns: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    started_at: datetime
    last_at: datetime
    duration_seconds: float
    status: SessionStatus
    stop_reason: str | None = None
    events: int
    limits: list[SessionLimit] = Field(default_factory=list)  # filled by B-05


class SessionPage(BaseModel):
    data: list[Session]
    next_cursor: str | None


@dataclass(frozen=True)
class EventFilters:
    agent_id: str | None = None
    rule_id: str | None = None
    action: Action | None = None
    kind: Kind | None = None
    context_id: str | None = None
    limit: int = 50
    before: tuple[datetime, str] | None = None  # (at, id) of the last event already shown


@dataclass(frozen=True)
class SessionFilters:
    agent_id: str | None = None
    status: SessionStatus | None = None
    limit: int = 50
    offset: int = 0


def to_session(counters: SessionCounters, agent_name: str | None, events: int) -> Session:
    return Session(
        **counters.model_dump(exclude={"stopped_at"}),
        agent_name=agent_name,
        duration_seconds=max((counters.last_at - counters.started_at).total_seconds(), 0.0),
        status="stopped" if counters.stopped_at else "active",
        events=events,
    )
