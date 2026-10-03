"""In-memory state until A-01 adds a database."""

from dataclasses import dataclass, field

from app.guardrails.models import Guardrail, InjectionSignature
from app.seeds import seed_guardrails, seed_signatures


@dataclass
class Store:
    guardrails: dict[str, Guardrail] = field(default_factory=dict)
    signatures: dict[str, InjectionSignature] = field(default_factory=dict)


def _seeded() -> Store:
    return Store(
        guardrails={g.id: g for g in seed_guardrails()},
        signatures={s.id: s for s in seed_signatures()},
    )


store = _seeded()


def reset_store() -> None:
    fresh = _seeded()
    store.guardrails = fresh.guardrails
    store.signatures = fresh.signatures
