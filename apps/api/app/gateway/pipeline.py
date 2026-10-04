"""B-02: run an agent's guardrails over the text of an A2A message, one stage at a time.

The order comes from app.bindings.resolve: mandatory guardrails first, then the agent's own,
in their set order. Each guardrail sees the message's text (contract §4) and:

- block   stops the stage at once; the caller gets a TASK_STATE_REJECTED task
- redact  rewrites the text parts, so the next guardrail checks the redacted text
- warn    only records the finding
- errors  a mandatory guardrail that errors fails closed (counts as a block); any other one is
          recorded as a warning and not enforced, so a broken optional rule can't take the
          agent down
"""

import time
from collections.abc import Sequence
from typing import Literal, Protocol

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from app.bindings.models import EffectiveGuardrail, Source
from app.gateway.a2a import Json, checked_text, text_parts
from app.guardrails.evaluate import GuardrailContext, evaluate
from app.guardrails.judge import Judge
from app.guardrails.models import DryRunResult, Engine, Guardrail, Stage
from app.store import store

Verdict = Literal["pass", "block", "redact", "warn"]


class GuardrailEngine(Protocol):
    """Runs one guardrail on one text (the T-04 engine interface). E-02 brings real engines."""

    def check(
        self,
        guardrail: Guardrail,
        text: str,
        stage: Stage,
        context: GuardrailContext | None = None,
    ) -> DryRunResult: ...


class LocalEngine:
    """The dry-run checks: regex, PII, signatures and moderation keywords are real; the LLM judge
    is real when a judge is given, otherwise it is a heuristic and says so with simulated=True."""

    def __init__(self, judge: Judge | None = None) -> None:
        self._judge = judge

    def check(
        self,
        guardrail: Guardrail,
        text: str,
        stage: Stage,
        context: GuardrailContext | None = None,
    ) -> DryRunResult:
        return evaluate(
            guardrail,
            text,
            list(store.signatures.values()),
            context=context,
            judge=self._judge,
        )


class TraceEntry(BaseModel):
    """One guardrail in the trace (FR-11). Field names match the web's TraceEntry."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    guardrail_id: str
    guardrail_name: str
    engine: Engine
    source: Source
    stage: Stage
    verdict: Verdict
    reason: str
    latency_ms: float
    simulated: bool = False


class StageOutcome(BaseModel):
    trace: list[TraceEntry]
    blocked_reason: str | None = None


def _entry(
    rule: EffectiveGuardrail,
    stage: Stage,
    verdict: Verdict,
    reason: str,
    started: float,
    simulated: bool = False,
) -> TraceEntry:
    return TraceEntry(
        guardrail_id=rule.guardrail.id,
        guardrail_name=rule.guardrail.name,
        engine=rule.guardrail.engine,
        source=rule.source,
        stage=stage,
        verdict=verdict,
        reason=reason,
        latency_ms=round((time.perf_counter() - started) * 1000, 2),
        simulated=simulated,
    )


def _blocked(rule: EffectiveGuardrail, reason: str) -> str:
    return f'Blocked by guardrail "{rule.guardrail.name}": {reason}'


def _check(
    engine: GuardrailEngine,
    guardrail: Guardrail,
    text: str,
    stage: Stage,
    context: GuardrailContext | None,
) -> DryRunResult:
    return engine.check(guardrail, text, stage, context)


def run_stage(
    rules: Sequence[EffectiveGuardrail],
    stage: Stage,
    holders: list[Json],
    engine: GuardrailEngine,
    context: GuardrailContext | None = None,
) -> StageOutcome:
    """Run `rules` on the messages/artifacts in `holders`; redactions change them in place."""
    trace: list[TraceEntry] = []

    for rule in rules:
        started = time.perf_counter()
        try:
            text, unchecked = checked_text(holders)
            result = _check(engine, rule.guardrail, text, stage, context)
            redacted: list[str] | None = None
            if result.result == "redact":
                # Redact part by part, so each text part keeps its place in the message.
                redacted = []
                for part in text_parts(holders):
                    piece = _check(engine, rule.guardrail, part["text"], stage, context)
                    changed = piece.result == "redact" and piece.output is not None
                    redacted.append(piece.output if changed and piece.output else part["text"])
        except Exception as error:  # an engine bug, a pattern timeout, a model outage
            failed = f"Guardrail failed ({type(error).__name__})"
            if rule.source == "mandatory":
                reason = f"{failed}; it is mandatory, so the call is blocked (fail closed)"
                trace.append(_entry(rule, stage, "block", reason, started))
                return StageOutcome(trace=trace, blocked_reason=_blocked(rule, reason))
            reason = f"{failed}; optional rule was not enforced"
            trace.append(_entry(rule, stage, "warn", reason, started))
            continue

        if redacted is not None:
            for part, new_text in zip(text_parts(holders), redacted, strict=True):
                part["text"] = new_text
        reason = result.reason
        if unchecked:
            reason += f" ({unchecked} file part(s) not checked)"
        verdict: Verdict = result.result
        if stage == "output" and verdict == "pass" and not text and unchecked:
            verdict = "warn"
            reason = f"No scannable text; {unchecked} file part(s) not checked"
        # llm_judge / moderation are keyword heuristics. A guessed block would look like a
        # real refusal, so it is downgraded to a warning that says so.
        if verdict == "block" and result.simulated:
            verdict = "warn"
            reason = f"{reason}; a simulated verdict cannot block, so this is a warning"
        trace.append(_entry(rule, stage, verdict, reason, started, result.simulated))
        if verdict == "block":
            return StageOutcome(trace=trace, blocked_reason=_blocked(rule, reason))

    return StageOutcome(trace=trace)


def dump_trace(trace: Sequence[TraceEntry]) -> list[Json]:
    return [entry.model_dump(by_alias=True) for entry in trace]
