"""B-05 (FR-25, FR-26): per-call and per-session limits on guarded calls.

Three limits, configured in app.core.config (env vars), each blocking or only warning:

- tokens: from the reply's metadata.usage when the agent sends it, otherwise estimated from
  the text (about 4 characters per token, contract §4)
- cost: the tokens priced from PRICES_PER_MILLION, by the model the agent reports
- time: the upstream call is cut after CALL_TIMEOUT_SECONDS (enforced in app.gateway.service)

Per-call caps look at one call; per-session caps add up every call of one A2A contextId, using
the A-07 session counters. Only a session cap stops the session; a call that is cut or refused
leaves the conversation open.
"""

from dataclasses import dataclass
from typing import Any, Literal

from app.audit.models import AuditEventIn, SessionCounters, SessionLimit
from app.core.config import settings
from app.gateway import a2a

LimitAction = Literal["block", "warn"]

# USD per million tokens (input, output). Illustrative list prices: edit them to your contracts.
# An agent names its model in metadata.usage.model or metadata.model; anything else is "default".
PRICES_PER_MILLION: dict[str, tuple[float, float]] = {
    "default": (3.00, 15.00),
    "mock": (0.0, 0.0),
}

CHARS_PER_TOKEN = 4

TIMEOUT_RULE_ID = "callTimeout"


@dataclass(frozen=True)
class CallUsage:
    input_tokens: int
    output_tokens: int
    cost_usd: float
    model: str
    estimated: bool  # True when the agent sent no metadata.usage

    @property
    def tokens(self) -> int:
        return self.input_tokens + self.output_tokens

    def as_hub(self) -> a2a.Json:
        """metadata.agentsOnRails.usage, in the shape the web's trace panel reads."""
        return {
            "inputTokens": self.input_tokens,
            "outputTokens": self.output_tokens,
            "costUsd": round(self.cost_usd, 6),
            "model": self.model,
            "estimated": self.estimated,
        }


@dataclass(frozen=True)
class LimitCheck:
    rule_id: str
    name: str
    unit: str
    used: float
    max: float
    action: LimitAction
    per_session: bool

    @property
    def exceeded(self) -> bool:
        return self.used > self.max

    def as_meter(self) -> a2a.Json:
        """One metadata.agentsOnRails.limits entry: { name, used, max, unit }."""
        return {"name": self.name, "used": round(self.used, 6), "max": self.max, "unit": self.unit}

    def reason(self) -> str:
        used = f"{self.used:.4f}" if self.unit == "USD" else f"{self.used:g}"
        return f"{self.name}: used {used} of {self.max:g} {self.unit}"


def estimate_tokens(text: str) -> int:
    return (len(text) + CHARS_PER_TOKEN - 1) // CHARS_PER_TOKEN


def price(model: str, input_tokens: int, output_tokens: int) -> float:
    per_input, per_output = PRICES_PER_MILLION.get(model, PRICES_PER_MILLION["default"])
    return (input_tokens * per_input + output_tokens * per_output) / 1_000_000


def _reported(result: a2a.Json) -> tuple[a2a.Json | None, str | None]:
    """The agent's own metadata.usage and model name, from the message or the task."""
    holder = (
        result.get("message") if isinstance(result.get("message"), dict) else result.get("task")
    )
    metadata = holder.get("metadata") if isinstance(holder, dict) else None
    if not isinstance(metadata, dict):
        return None, None
    usage = metadata.get("usage")
    usage = usage if isinstance(usage, dict) else None
    model = (usage or {}).get("model") or metadata.get("model")
    return usage, model if isinstance(model, str) and model else None


def call_usage(request_message: a2a.Json, reply: a2a.Json) -> CallUsage:
    """Tokens and cost of one answered call: the agent's own figures, else an estimate."""
    found = reply.get("result")
    result: a2a.Json = found if isinstance(found, dict) else {}
    reported, model = _reported(result)
    name = model if model in PRICES_PER_MILLION else "default"
    if reported is not None and {"inputTokens", "outputTokens"} <= reported.keys():
        input_tokens, output_tokens = a2a.usage_tokens(reply)
        estimated = False
    else:
        sent, _ = a2a.checked_text([request_message])
        answered, _ = a2a.checked_text(a2a.reply_holders(result))
        input_tokens, output_tokens = estimate_tokens(sent), estimate_tokens(answered)
        estimated = True
    return CallUsage(
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        cost_usd=price(name, input_tokens, output_tokens),
        model=model or name,
        estimated=estimated,
    )


def check(usage: CallUsage, session: SessionCounters | None) -> list[LimitCheck]:
    """Every switched-on limit with how much of it this call (and its session) used."""
    checks: list[LimitCheck] = []
    if settings.MAX_CALL_TOKENS > 0:
        checks.append(
            LimitCheck(
                "maxCallTokens",
                "Tokens per call",
                "tokens",
                usage.tokens,
                settings.MAX_CALL_TOKENS,
                settings.CALL_TOKENS_ACTION,
                per_session=False,
            )
        )
    if settings.MAX_CALL_COST_USD > 0:
        checks.append(
            LimitCheck(
                "maxCallCost",
                "Cost per call",
                "USD",
                usage.cost_usd,
                settings.MAX_CALL_COST_USD,
                settings.CALL_COST_ACTION,
                per_session=False,
            )
        )
    if session is not None:
        checks.extend(_session_checks(session))
    return checks


def _session_checks(session: SessionCounters) -> list[LimitCheck]:
    checks: list[LimitCheck] = []
    if settings.MAX_SESSION_TOKENS > 0:
        checks.append(
            LimitCheck(
                "maxSessionTokens",
                "Session tokens",
                "tokens",
                session.input_tokens + session.output_tokens,
                settings.MAX_SESSION_TOKENS,
                settings.SESSION_TOKENS_ACTION,
                per_session=True,
            )
        )
    if settings.MAX_SESSION_COST_USD > 0:
        checks.append(
            LimitCheck(
                "maxSessionCost",
                "Session cost",
                "USD",
                float(session.cost_usd),
                settings.MAX_SESSION_COST_USD,
                settings.SESSION_COST_ACTION,
                per_session=True,
            )
        )
    return checks


def session_limits(session: SessionCounters) -> list[SessionLimit]:
    """Session.limits for the A-07 sessions API: the session caps as meters."""
    return [
        SessionLimit(name=c.name, used=round(c.used, 6), max=c.max, unit=c.unit)
        for c in _session_checks(session)
    ]


def _context(context_id: Any) -> str:
    return f" (context {context_id})" if isinstance(context_id, str) and context_id else ""


def audit_event(limit: LimitCheck, policy_version: str | None, context_id: Any) -> AuditEventIn:
    """A limit hit. Per-call hits name their context in the details, because they are recorded
    without one: an A-07 limit block with a context stops the session, and only a session cap
    should do that."""
    details = limit.reason() if limit.per_session else limit.reason() + _context(context_id)
    return AuditEventIn(
        rule_id=limit.rule_id,
        rule_name=limit.name,
        kind="limit",
        action=limit.action,
        config_version=policy_version,
        details=details[:500],
    )


def timeout_event(context_id: Any, policy_version: str | None) -> AuditEventIn:
    """The audit record of a call cut at the time limit (the call is blocked, not the session)."""
    session = _context(context_id)
    return AuditEventIn(
        rule_id=TIMEOUT_RULE_ID,
        rule_name="Call timeout",
        kind="limit",
        action="block",
        config_version=policy_version,
        details=f"Agent did not answer within {settings.CALL_TIMEOUT_SECONDS:g}s{session}",
    )
