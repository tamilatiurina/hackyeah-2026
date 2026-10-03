"""Dry-run a guardrail on sample text (FR-20).

Regex, PII and prompt injection on the regex engine run for real. LLM judge and moderation have
no model behind them yet, so their verdicts are keyword heuristics marked simulated.
"""

import re
from collections.abc import Sequence

import regex

from app.guardrails.models import (
    DryRunResult,
    GuardrailRule,
    InjectionSignature,
    LlmJudgeConfig,
    PiiConfig,
    PromptInjectionConfig,
    RegexConfig,
    TopicConfig,
    ToxicityConfig,
)

# Order matters: longer, more specific entities are redacted first so their digits are not
# reported again as a PHONE.
PII_PATTERNS: dict[str, re.Pattern[str]] = {
    # Compact or printed in groups: "DE89370400440532013000" or "DE89 3704 0044 0532 0130 00".
    "IBAN": re.compile(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b"),
    "CREDIT_CARD": re.compile(r"\b(?:\d[ -]?){12,18}\d\b"),
    "EMAIL": re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"),
    "PHONE": re.compile(r"\+?\d[\d\s-]{7,}\d"),
}

# User-supplied patterns run with a deadline: the regex package can stop a catastrophic backtrack,
# plain re cannot (and it holds the GIL while it spins).
PATTERN_TIMEOUT_S = 1.0


class PatternTimeoutError(Exception):
    """A user-supplied pattern ran past PATTERN_TIMEOUT_S."""


def _search(pattern: str, text: str) -> bool:
    try:
        return regex.search(pattern, text, timeout=PATTERN_TIMEOUT_S) is not None
    except TimeoutError as e:
        raise PatternTimeoutError from e


def _replace_literal(pattern: str, replacement: str, text: str) -> str:
    # A function replacement inserts the text as-is: no backslash or group template expansion.
    try:
        result: str = regex.sub(pattern, lambda _: replacement, text, timeout=PATTERN_TIMEOUT_S)
    except TimeoutError as e:
        raise PatternTimeoutError from e
    return result


TOXIC_WORDS = ["idiot", "stupid", "moron", "shut up", "hate you", "useless"]


def _luhn_ok(candidate: str) -> bool:
    digits = [int(c) for c in candidate if c.isdigit()]
    if not 13 <= len(digits) <= 19:
        return False
    total = 0
    for i, digit in enumerate(reversed(digits)):
        if i % 2 == 1:
            digit *= 2
            if digit > 9:
                digit -= 9
        total += digit
    return total % 10 == 0


def _redact_entity(entity: str, text: str) -> tuple[int, str]:
    count = 0

    def replace(match: re.Match[str]) -> str:
        nonlocal count
        if entity == "CREDIT_CARD" and not _luhn_ok(match.group()):
            return match.group()
        count += 1
        return f"[{entity}]"

    redacted = PII_PATTERNS[entity].sub(replace, text)  # runs replace(), which updates count
    return count, redacted


def _pii(config: PiiConfig, text: str) -> tuple[list[str], str]:
    found: list[str] = []
    redacted = text
    for entity in PII_PATTERNS:
        if entity not in config.entities:
            continue
        count, redacted = _redact_entity(entity, redacted)
        if count:
            found.append(entity)
    # Report in the user's reading order of the default list, not the redaction order.
    order = ["EMAIL", "PHONE", "CREDIT_CARD", "IBAN"]
    found.sort(key=order.index)
    return found, redacted


def evaluate(
    rule: GuardrailRule, text: str, signatures: Sequence[InjectionSignature]
) -> DryRunResult:
    simulated = rule.engine in ("llm_judge", "moderation")
    lowered = text.lower()
    reason: str | None = None
    redacted: str | None = None

    config = rule.config
    if isinstance(config, RegexConfig):
        if _search(config.pattern, text):
            reason = f"Matched /{config.pattern}/"
            redacted = _replace_literal(config.pattern, config.replacement, text)
    elif isinstance(config, PiiConfig):
        found, pii_redacted = _pii(config, text)
        if found:
            reason = f"Found {', '.join(found)}"
            redacted = pii_redacted
    elif isinstance(config, PromptInjectionConfig):
        ids = [s.id for s in signatures if _search(s.regex, text)]
        if ids:
            reason = f"Matched injection signature: {', '.join(ids)}"
    elif isinstance(config, ToxicityConfig):
        words = [w for w in TOXIC_WORDS if w in lowered]
        if words:
            reason = f"Abusive language: {', '.join(words)}"
    elif isinstance(config, TopicConfig):
        present = [t for t in config.topics if t.lower() in lowered]
        if config.mode == "allow" and not present:
            reason = f"Off topic: mentions none of {', '.join(config.topics)}"
        elif config.mode == "deny" and present:
            reason = f"Mentions a denied topic: {', '.join(present)}"
    elif isinstance(config, LlmJudgeConfig):
        prompt_words = dict.fromkeys(w.lower() for w in re.findall(r"[A-Za-z]{6,}", config.prompt))
        shared = [w for w in prompt_words if w in lowered]
        if shared:
            reason = f"Shares wording with the judge prompt: {', '.join(shared)}"

    if reason is None:
        return DryRunResult(
            result="pass",
            reason="Simulated judge found nothing to flag" if simulated else "No match",
            simulated=simulated,
        )
    return DryRunResult(
        result=rule.action,
        reason=f"Simulated: {reason}" if simulated else reason,
        output=redacted if rule.action == "redact" else None,
        simulated=simulated,
    )
