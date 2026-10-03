import re
from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, field_validator, model_validator

Engine = Literal["regex", "llm_judge", "library", "moderation"]
Stage = Literal["input", "output"]
Action = Literal["block", "redact", "warn"]
TemplateId = Literal["pii", "prompt_injection", "toxicity", "topic", "regex", "llm_judge"]
PiiEntity = Literal["EMAIL", "PHONE", "CREDIT_CARD", "IBAN"]
PII_ENTITIES: tuple[PiiEntity, ...] = ("EMAIL", "PHONE", "CREDIT_CARD", "IBAN")


def _must_compile(pattern: str) -> str:
    try:
        re.compile(pattern)
    except re.error as e:
        raise ValueError(f"invalid regex: {e}") from e
    return pattern


# --- per-template config (the discriminator is "template") ---
class PiiConfig(BaseModel):
    template: Literal["pii"]
    entities: list[PiiEntity] = Field(default=list(PII_ENTITIES), min_length=1)


class PromptInjectionConfig(BaseModel):
    template: Literal["prompt_injection"]
    use_company_signatures: bool = True


class ToxicityConfig(BaseModel):
    template: Literal["toxicity"]
    threshold: float = Field(default=0.7, ge=0, le=1)


class TopicConfig(BaseModel):
    template: Literal["topic"]
    mode: Literal["allow", "deny"]
    topics: list[str] = Field(min_length=1)


class RegexConfig(BaseModel):
    template: Literal["regex"]
    pattern: str = Field(min_length=1)
    replacement: str = "[REDACTED]"

    @field_validator("pattern")
    @classmethod
    def must_compile(cls, v: str) -> str:
        return _must_compile(v)


class LlmJudgeConfig(BaseModel):
    template: Literal["llm_judge"]
    prompt: str = Field(min_length=10)


GuardrailConfig = Annotated[
    PiiConfig | PromptInjectionConfig | ToxicityConfig | TopicConfig | RegexConfig | LlmJudgeConfig,
    Field(discriminator="template"),
]


# --- template catalog: which engines can run it, which actions it allows ---
class TemplateInfo(BaseModel):
    id: TemplateId
    label: str
    engines: list[Engine]
    actions: list[Action]
    # Detectors the template can name in config. Absent unless the template has a closed set.
    entities: list[PiiEntity] | None = None


TEMPLATES: dict[str, TemplateInfo] = {
    t.id: t
    for t in [
        TemplateInfo(
            id="pii",
            label="PII",
            engines=["library"],
            actions=["block", "redact", "warn"],
            entities=list(PII_ENTITIES),
        ),
        TemplateInfo(
            id="prompt_injection",
            label="Prompt injection",
            engines=["regex", "llm_judge"],
            actions=["block", "warn"],
        ),
        TemplateInfo(
            id="toxicity",
            label="Toxicity",
            engines=["moderation", "llm_judge"],
            actions=["block", "warn"],
        ),
        TemplateInfo(
            id="topic",
            label="Topic allow/deny list",
            engines=["llm_judge"],
            actions=["block", "warn"],
        ),
        TemplateInfo(
            id="regex", label="Regex", engines=["regex"], actions=["block", "redact", "warn"]
        ),
        TemplateInfo(
            id="llm_judge", label="LLM judge", engines=["llm_judge"], actions=["block", "warn"]
        ),
    ]
}


# --- guardrails ---
class GuardrailRule(BaseModel):
    """What a guardrail checks; shared by create and dry run."""

    engine: Engine
    stages: list[Stage] = Field(min_length=1)
    action: Action
    config: GuardrailConfig

    @model_validator(mode="after")
    def check_rule(self) -> Self:
        template = TEMPLATES[self.config.template]
        if self.engine not in template.engines:
            raise ValueError(
                f"engine '{self.engine}' not allowed for template '{template.id}' "
                f"(allowed: {', '.join(template.engines)})"
            )
        if self.action not in template.actions:
            raise ValueError(
                f"action '{self.action}' not allowed for template "
                f"'{template.id}' (allowed: {', '.join(template.actions)})"
            )
        if len(set(self.stages)) != len(self.stages):
            raise ValueError("stages must be unique")
        return self


class GuardrailCreate(GuardrailRule):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    is_mandatory: bool = Field(
        default=False,
        description="If True, applies to all agents globally and cannot be detached (admin only)",
    )


class Guardrail(GuardrailCreate):
    id: str
    enabled: bool = True


class GuardrailUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    description: str | None = Field(default=None, max_length=200)
    enabled: bool | None = None
    is_mandatory: bool | None = None

    @model_validator(mode="after")
    def no_nulls_for_required_fields(self) -> Self:
        for field in ("name", "enabled"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


# --- injection signatures (policy.schema.json "regexRule" without replacement) ---
class InjectionSignature(BaseModel):
    id: str = Field(min_length=1, max_length=60, pattern=r"^[a-z0-9][a-z0-9-]*$")
    regex: str = Field(min_length=1, max_length=500)

    @field_validator("regex")
    @classmethod
    def must_compile(cls, v: str) -> str:
        return _must_compile(v)


# --- dry run ---
class DryRunRequest(GuardrailRule):
    text: str = Field(min_length=1, max_length=10_000)


class DryRunResult(BaseModel):
    result: Literal["pass", "block", "redact", "warn"]
    reason: str
    output: str | None = None
    simulated: bool
