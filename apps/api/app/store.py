"""In-memory state until A-01 adds a database."""

from dataclasses import dataclass, field

from app.guardrails.models import Guardrail
from app.seeds import seed_guardrails


@dataclass
class Store:
    guardrails: dict[str, Guardrail] = field(default_factory=dict)


def _seeded() -> Store:
    return Store(guardrails={g.id: g for g in seed_guardrails()})


store = _seeded()


def reset_store() -> None:
    fresh = _seeded()
    store.guardrails = fresh.guardrails
