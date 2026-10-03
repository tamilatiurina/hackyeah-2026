"""In-memory audit store (no Supabase: local runs, tests). Shared by the recorder and the reads."""

from dataclasses import dataclass, field

from app.audit.models import AuditEvent, SessionCounters


@dataclass
class MemoryAudit:
    sessions: dict[tuple[str, str], SessionCounters] = field(default_factory=dict)
    events: list[AuditEvent] = field(default_factory=list)  # oldest first


MEMORY = MemoryAudit()


def reset_in_memory_audit() -> None:
    MEMORY.sessions.clear()
    MEMORY.events.clear()
