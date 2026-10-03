"""FR-05 / FR-07: turn the library plus its bindings into the set the gateway runs.

Rules, in order:

1. Mandatory guardrails (FR-06) always come first, in library order. No binding can add,
   reorder or remove them.
2. Everything else comes from bindings whose scope matches the request: the agent, the
   caller's role and the caller themselves. Scopes are unioned, not replaced.
3. Disabled bindings and disabled guardrails are skipped.
4. A guardrail bound from two scopes runs once, at its strongest position: lowest
   order_index wins, then agent before role before user.
5. The result is split per stage, because a guardrail only runs on the stages it declares.
"""

from collections.abc import Sequence
from hashlib import sha256

from app.bindings.models import (
    SCOPE_RANK,
    Binding,
    EffectiveGuardrail,
    EffectivePolicy,
    ScopeType,
    Source,
)
from app.bindings.repository import BindingRepository
from app.guardrails.models import Guardrail
from app.guardrails.repository import GuardrailRepository


def _matches(binding: Binding, agent_id: str | None, role: str | None, user_id: str | None) -> bool:
    selector = {"agent": agent_id, "role": role, "user": user_id}[binding.scope_type]
    return selector is not None and binding.scope_id == selector


def _version(entries: Sequence[EffectiveGuardrail]) -> str:
    """Changes whenever the resolved set, its order or its actions change.

    The gateway caches an effective policy under this value, so editing a binding or a
    guardrail is picked up on the next request without a restart.
    """
    digest = sha256()
    for entry in entries:
        rule = entry.guardrail
        digest.update(
            f"{entry.source}|{rule.id}|{rule.action}|{rule.engine}|"
            f"{','.join(rule.stages)}|{rule.config.model_dump_json()}\n".encode()
        )
    return digest.hexdigest()[:12]


def resolve(
    guardrails: Sequence[Guardrail],
    bindings: Sequence[Binding],
    agent_id: str | None = None,
    role: str | None = None,
    user_id: str | None = None,
) -> EffectivePolicy:
    library = {rule.id: rule for rule in guardrails}
    library_index = {rule.id: position for position, rule in enumerate(guardrails)}

    entries = [
        EffectiveGuardrail(guardrail=rule, source="mandatory", order_index=0)
        for rule in guardrails
        if rule.enabled and rule.is_mandatory
    ]

    attached: list[tuple[int, int, int, EffectiveGuardrail]] = []
    for binding in bindings:
        rule = library.get(binding.guardrail_id)
        if rule is None or not rule.enabled or rule.is_mandatory or not binding.enabled:
            continue
        if not _matches(binding, agent_id, role, user_id):
            continue
        source: Source = binding.scope_type
        attached.append(
            (
                binding.order_index,
                SCOPE_RANK[source],
                library_index[rule.id],
                EffectiveGuardrail(
                    guardrail=rule,
                    source=source,
                    binding_id=binding.id,
                    order_index=binding.order_index,
                ),
            )
        )

    seen = {entry.guardrail.id for entry in entries}
    for *_, entry in sorted(attached, key=lambda item: item[:3]):
        if entry.guardrail.id in seen:
            continue  # same guardrail from a weaker scope; the stronger one already runs
        seen.add(entry.guardrail.id)
        entries.append(entry)

    return EffectivePolicy(
        agent_id=agent_id,
        role=role,
        user_id=user_id,
        version=_version(entries),
        input=[e for e in entries if "input" in e.guardrail.stages],
        output=[e for e in entries if "output" in e.guardrail.stages],
    )


def resolve_for_request(
    guardrails: GuardrailRepository,
    bindings: BindingRepository,
    agent_id: str | None = None,
    role: str | None = None,
    user_id: str | None = None,
) -> EffectivePolicy:
    """Read the catalog and resolve it for one request.

    Shared by the gateway and GET /effective-guardrails so the two can never disagree about
    which bindings a request matches. Blocking I/O: call it from a worker thread.
    """
    selectors: list[tuple[ScopeType, str]] = []
    if agent_id is not None:
        selectors.append(("agent", agent_id))
    if role is not None:
        selectors.append(("role", role))
    if user_id is not None:
        selectors.append(("user", user_id))

    scoped: list[Binding] = []
    for scope_type, scope_id in selectors:
        scoped.extend(bindings.list(scope_type, scope_id))
    return resolve(guardrails.list(), scoped, agent_id=agent_id, role=role, user_id=user_id)
