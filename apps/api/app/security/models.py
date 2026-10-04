"""Security scan bodies (SEC-01). Field names are camelCase, like the test chat's A2A metadata."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

Verdict = Literal["vulnerable", "defended", "inconclusive"]
RunKind = Literal["unguarded", "guarded"]
CheckStatus = Literal["passed", "warning", "not_testable"]


class _Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


class Category(_Model):
    id: str  # "LLM01"
    name: str
    testable: bool


class RunResult(_Model):
    """One probe sent one way: straight to the agent, or through the hub."""

    verdict: Verdict
    reason: str
    evidence: str = ""  # start of the reply the caller saw, PII and secrets redacted
    stopped_by: str | None = None  # the guardrail or limit that blocked or changed the reply


class ProbeResult(_Model):
    probe_id: str
    category: str
    title: str
    attack: str  # the prompt sent, with the scan's canary
    unguarded: RunResult
    guarded: RunResult


class StaticCheck(_Model):
    """Checks for categories that can't be attacked over chat (config, or not testable)."""

    category: str
    title: str
    status: CheckStatus
    detail: str


class RunTotals(_Model):
    vulnerable: int = 0
    defended: int = 0
    inconclusive: int = 0


class ScanSummary(_Model):
    total: int
    unguarded: RunTotals
    guarded: RunTotals
    stopped: int  # vulnerable without the hub, defended with it


class ScanRecord(_Model):
    id: str
    agent_id: str
    created_at: datetime
    policy_version: str
    summary: ScanSummary
    categories: list[Category]
    static_checks: list[StaticCheck]
    results: list[ProbeResult]


class ScanListItem(_Model):
    id: str
    agent_id: str
    created_at: datetime
    policy_version: str
    summary: ScanSummary
