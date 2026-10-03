"""FR-07 / FR-11: run the resolved policy on an A2A call and report what happened.

The gateway resolves which guardrails apply to one (agent, role, user) triple, runs them on the
user's text on the way in and on the agent's reply on the way out, and puts the trace in
`metadata.guardrailHub` (docs/agent-contract-a2a.md, sections 4 and 5).

Two rules hold throughout:

- **A simulated verdict never blocks.** `llm_judge` and `moderation` have no model behind them
  yet, so their verdicts are keyword heuristics. Letting one refuse a call would report a guess
  as a judgement, so it is downgraded to a warning that says so.
- **A stage has a time budget.** `PATTERN_TIMEOUT_S` in app.guardrails.evaluate caps a single
  pattern, so a long library can still add up to minutes. Guardrails left over when the budget
  runs out are reported as skipped rather than silently not running.
"""

import time
from collections.abc import Sequence
from dataclasses import dataclass, field
from typing import Any, Literal

from app.bindings.models import EffectivePolicy
from app.guardrails.evaluate import PatternTimeoutError, evaluate
from app.guardrails.models import Guardrail, InjectionSignature, Stage

Json = dict[str, Any]

# Hub data lives only under this key in A2A metadata (AGENTS.md).
HUB_KEY = "guardrailHub"

# Role and user ids are binding selectors, so they share Binding.scope_id's limit.
MAX_SELECTOR_LENGTH = 120

# How long all guardrails on one stage may take together.
STAGE_BUDGET_SECONDS = 0.2

# "skipped" and "error" are ours: a guardrail that did not get to run, and one that failed.
TraceVerdict = Literal["pass", "block", "redact", "warn", "skipped", "error"]


@dataclass(frozen=True)
class Caller:
    """Who the gateway thinks is calling. A stand-in for real auth, like app.api.deps.get_role."""

    role: str | None = None
    user_id: str | None = None


@dataclass(frozen=True)
class Blocked:
    guardrail: Guardrail
    stage: Stage
    reason: str

    def refusal(self) -> str:
        return f'Blocked by guardrail "{self.guardrail.name}": {self.reason}'


@dataclass
class StageResult:
    """What one stage did. Text parts are rewritten in place, so `parts` needs no copy back."""

    trace: list[Json] = field(default_factory=list)
    blocked: Blocked | None = None
    rewritten: bool = False


def _selector(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    trimmed = value.strip()
    return trimmed if 0 < len(trimmed) <= MAX_SELECTOR_LENGTH else None


def _hub_params(call: Json) -> Json:
    params = call.get("params")
    metadata = params.get("metadata") if isinstance(params, dict) else None
    hub = metadata.get(HUB_KEY) if isinstance(metadata, dict) else None
    return hub if isinstance(hub, dict) else {}


def read_caller(call: Json, header_role: str | None = None) -> tuple[Caller, bool]:
    """The caller's role and id, and whether non-A2A demo fields were stripped off `call`.

    Three places are read, strongest first: `params.metadata.guardrailHub`, which is where the
    contract puts hub data; top-level `role` and `userId`, which is what the demo client sends;
    and the `X-Role` header the panel uses elsewhere in the API. The top-level fields are not
    A2A, so they are removed before the call is forwarded.
    """
    hub = _hub_params(call)
    stripped = False
    top_level: Json = {}
    for field_name in ("role", "userId"):
        if field_name in call:
            top_level[field_name] = call.pop(field_name)
            stripped = True
    caller = Caller(
        role=(
            _selector(hub.get("role")) or _selector(top_level.get("role")) or _selector(header_role)
        ),
        user_id=_selector(hub.get("userId")) or _selector(top_level.get("userId")),
    )
    return caller, stripped


def text_parts(parts: Any) -> list[Json]:
    """The parts a guardrail may read and rewrite: the text ones (contract section 4)."""
    if not isinstance(parts, list):
        return []
    return [p for p in parts if isinstance(p, dict) and isinstance(p.get("text"), str)]


def _joined(parts: Sequence[Json]) -> str:
    return "\n".join(str(part["text"]) for part in parts)


def _trace_entry(
    rule: Guardrail,
    stage: Stage,
    verdict: TraceVerdict,
    reason: str,
    latency_s: float,
    simulated: bool,
) -> Json:
    return {
        "guardrailId": rule.id,
        "guardrailName": rule.name,
        "engine": rule.engine,
        "stage": stage,
        "verdict": verdict,
        "reason": reason,
        "latencyMs": round(latency_s * 1000, 1),
        "simulated": simulated,
    }


def _redact_in_place(
    rule: Guardrail, parts: Sequence[Json], signatures: Sequence[InjectionSignature]
) -> None:
    """Rewrite each text part on its own, so part structure and metadata survive redaction."""
    for part in parts:
        try:
            single = evaluate(rule, str(part["text"]), signatures)
        except PatternTimeoutError:
            continue
        if single.output is not None:
            part["text"] = single.output


def run_stage(
    policy: EffectivePolicy,
    stage: Stage,
    parts: Any,
    signatures: Sequence[InjectionSignature],
) -> StageResult:
    """Run the stage's guardrails over `parts`, rewriting text in place where one redacts."""
    result = StageResult()
    checkable = text_parts(parts)
    if not checkable:
        return result  # nothing a guardrail can read; raw and url parts pass unchecked

    deadline = time.perf_counter() + STAGE_BUDGET_SECONDS
    for entry in policy.stage(stage):
        rule = entry.guardrail
        if time.perf_counter() >= deadline:
            result.trace.append(
                _trace_entry(rule, stage, "skipped", "Stage time budget used up", 0.0, False)
            )
            continue

        started = time.perf_counter()
        try:
            verdict = evaluate(rule, _joined(checkable), signatures)
        except PatternTimeoutError:
            elapsed = time.perf_counter() - started
            reason = "Pattern took too long on this text"
            result.trace.append(_trace_entry(rule, stage, "error", reason, elapsed, False))
            continue
        elapsed = time.perf_counter() - started

        action: TraceVerdict = verdict.result
        reason = verdict.reason
        if action == "block" and verdict.simulated:
            action = "warn"
            reason = f"{reason}; a simulated verdict cannot block, so this is a warning"

        if action == "redact":
            _redact_in_place(rule, checkable, signatures)
            result.rewritten = True

        result.trace.append(_trace_entry(rule, stage, action, reason, elapsed, verdict.simulated))

        if action == "block":
            result.blocked = Blocked(guardrail=rule, stage=stage, reason=verdict.reason)
            break  # nothing after a refusal would change the outcome

    return result


def hub_metadata(
    policy: EffectivePolicy,
    caller: Caller,
    trace: Sequence[Json],
    blocked: Blocked | None = None,
) -> Json:
    """The `guardrailHub` block: the trace, plus enough context to audit the decision.

    `policyVersion` is the hash from app.bindings.resolve, so a config edit shows up here on the
    next request without a restart.
    """
    hub: Json = {"policyVersion": policy.version, "trace": list(trace)}
    if caller.role is not None:
        hub["role"] = caller.role
    if caller.user_id is not None:
        hub["userId"] = caller.user_id
    if blocked is not None:
        hub["blocked"] = True
        hub["stage"] = blocked.stage
    return hub


def attach_hub(container: Json, hub: Json) -> None:
    """Merge the hub block into an A2A message's or task's metadata, keeping what is there."""
    metadata = container.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        container["metadata"] = metadata
    existing = metadata.get(HUB_KEY)
    metadata[HUB_KEY] = {**existing, **hub} if isinstance(existing, dict) else hub
