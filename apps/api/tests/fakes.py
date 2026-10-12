"""In-memory stand-ins for Supabase, for tests only.

The API always runs against Supabase as the signed-in user. Tests swap every storage
dependency for these fakes (see `use_fakes`, applied to each test by conftest.py), so routes
run with one fake signed-in user and a seeded library, and assertions read the stores below.
Row-level security itself is tested in SQL: apps/api/supabase/tests/ownership.test.sql.
"""

from collections import Counter
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

from app.api.routes import test_chat
from app.audit import cursor
from app.audit.models import (
    AuditEvent,
    AuditEventIn,
    AuditEventPage,
    AuditRule,
    EventFilters,
    SessionCounters,
    SessionFilters,
    SessionPage,
)
from app.audit.recorder import get_audit_recorder, stop_reason
from app.audit.repository import event_cursor, get_audit_repository, sorted_rules, with_limits
from app.bindings.models import Binding, EffectivePolicy, ScopeType
from app.bindings.repository import get_binding_repository
from app.bindings.resolve import resolve_for_request
from app.core.auth import CurrentUser, get_current_user
from app.gateway import router as gateway_router
from app.gateway.policy import get_policy_loader
from app.guardrails.models import Guardrail, InjectionSignature
from app.guardrails.repository import get_guardrail_repository
from app.guardrails.signatures import get_signature_repository
from app.mcp.agent_access import get_agent_mcp_repository, get_gateway_mcp_loader
from app.mcp.models import (
    AgentMcpServer,
    McpGrant,
    McpServer,
    McpServerCreate,
    McpServerUpdate,
    summarize,
)
from app.mcp.repository import NameTakenError, from_row, get_mcp_server_repository, to_row
from app.profiles import Step, get_profile_repository
from app.security.models import ScanListItem, ScanRecord
from app.security.repository import HISTORY_LIMIT, get_scan_repository
from app.seeds import seed_guardrails, seed_signatures
from fastapi import FastAPI, HTTPException, status

Tools = list[str]  # module-level: `list` is also a method name in the classes below

OWNER_ID = "971f4031-2dd9-4327-94c7-45323de61c67"
OWNER_EMAIL = "owner@example.com"


def fake_user() -> CurrentUser:
    """The signed-in user every test request runs as (no real Supabase client)."""
    return CurrentUser(id=OWNER_ID, email=OWNER_EMAIL, client=MagicMock())


# --- the stores ----------------------------------------------------------------------------------


@dataclass
class Store:
    guardrails: dict[str, Guardrail] = field(default_factory=dict)
    signatures: dict[str, InjectionSignature] = field(default_factory=dict)
    bindings: dict[str, Binding] = field(default_factory=dict)


@dataclass
class MemoryAudit:
    sessions: dict[tuple[str, str], SessionCounters] = field(default_factory=dict)
    events: list[AuditEvent] = field(default_factory=list)  # oldest first


store = Store()
MEMORY = MemoryAudit()
SERVERS: dict[str, McpServer] = {}  # id -> public server (secrets are not kept)
ACCESS: dict[tuple[str, str], list[str]] = {}  # (agent id, server id) -> tools it may call
SCANS: dict[str, ScanRecord] = {}
PROFILE: set[Step] = {"bootstrapped_at", "demo_agent_added_at"}  # setup steps done


def reset() -> None:
    """A fresh account with the seed library, as the first-sign-in bootstrap leaves it."""
    store.guardrails = {g.id: g for g in seed_guardrails()}
    store.signatures = {s.id: s for s in seed_signatures()}
    store.bindings = {}
    MEMORY.sessions.clear()
    MEMORY.events.clear()
    SERVERS.clear()
    ACCESS.clear()
    SCANS.clear()
    PROFILE.clear()
    PROFILE.update({"bootstrapped_at", "demo_agent_added_at"})


# --- library -------------------------------------------------------------------------------------


class InMemoryGuardrailRepository:
    def list(self) -> list[Guardrail]:
        return list(store.guardrails.values())

    def get(self, guardrail_id: str) -> Guardrail | None:
        return store.guardrails.get(guardrail_id)

    def add(self, guardrail: Guardrail) -> None:
        store.guardrails[guardrail.id] = guardrail

    def replace(self, guardrail: Guardrail) -> None:
        store.guardrails[guardrail.id] = guardrail

    def delete(self, guardrail_id: str) -> bool:
        return store.guardrails.pop(guardrail_id, None) is not None


class InMemorySignatureRepository:
    def list(self) -> list[InjectionSignature]:
        return list(store.signatures.values())

    def add(self, signature: InjectionSignature) -> None:
        if signature.id in store.signatures:
            raise HTTPException(status.HTTP_409_CONFLICT, "A signature with this id already exists")
        store.signatures[signature.id] = signature

    def delete(self, signature_id: str) -> bool:
        return store.signatures.pop(signature_id, None) is not None


class InMemorySignatureLoader:
    def load(self, agent_id: str, key: str) -> list[InjectionSignature]:
        del agent_id, key  # the gateway checked the key already
        return list(store.signatures.values())


class InMemoryBindingRepository:
    def list(
        self, scope_type: ScopeType | None = None, scope_id: str | None = None
    ) -> list[Binding]:
        return [
            binding
            for binding in store.bindings.values()
            if (scope_type is None or binding.scope_type == scope_type)
            and (scope_id is None or binding.scope_id == scope_id)
        ]

    def get(self, binding_id: str) -> Binding | None:
        return store.bindings.get(binding_id)

    def find(self, scope_type: ScopeType, scope_id: str, guardrail_id: str) -> Binding | None:
        for binding in store.bindings.values():
            if (
                binding.scope_type == scope_type
                and binding.scope_id == scope_id
                and binding.guardrail_id == guardrail_id
            ):
                return binding
        return None

    def add(self, binding: Binding) -> None:
        store.bindings[binding.id] = binding

    def replace(self, binding: Binding) -> None:
        store.bindings[binding.id] = binding

    def delete(self, binding_id: str) -> bool:
        return store.bindings.pop(binding_id, None) is not None

    def delete_for_guardrail(self, guardrail_id: str) -> None:
        for binding_id in [b.id for b in store.bindings.values() if b.guardrail_id == guardrail_id]:
            del store.bindings[binding_id]


class CatalogPolicyLoader:
    """The gateway's guardrails, read from the in-memory library."""

    def load(self, agent_id: str, key: str, role: str | None = None) -> EffectivePolicy:
        del key  # the caller is already authenticated by the resolver
        return resolve_for_request(
            InMemoryGuardrailRepository(), InMemoryBindingRepository(), agent_id=agent_id, role=role
        )


# --- MCP -----------------------------------------------------------------------------------------


def _sync_access(server_id: str, tools: list[str]) -> None:
    """Like the sync_agent_mcp_tools trigger: removed tools leave every agent."""
    for key, allowed in list(ACCESS.items()):
        if key[1] != server_id:
            continue
        kept = [t for t in allowed if t in tools]
        if kept:
            ACCESS[key] = kept
        else:
            del ACCESS[key]


class InMemoryMcpServerRepository:
    def list(self) -> list[McpServer]:
        return list(SERVERS.values())

    def get(self, server_id: str) -> McpServer | None:
        return SERVERS.get(server_id)

    def add(self, server_id: str, body: McpServerCreate) -> McpServer:
        if any(s.name.lower() == body.name.lower() for s in SERVERS.values()):
            raise NameTakenError
        server = from_row(to_row(server_id, body))
        SERVERS[server_id] = server
        return server

    def update(self, server_id: str, changes: McpServerUpdate) -> McpServer | None:
        current = SERVERS.get(server_id)
        if current is None:
            return None
        if changes.name is not None and any(
            s.id != server_id and s.name.lower() == changes.name.lower() for s in SERVERS.values()
        ):
            raise NameTakenError
        updated = current.model_copy(
            update={
                "name": changes.name if changes.name is not None else current.name,
                "url": changes.url if changes.url is not None else current.url,
                "auth": summarize(changes.auth) if changes.auth is not None else current.auth,
                "allowed_tools": (
                    list(changes.allowed_tools)
                    if changes.allowed_tools is not None
                    else current.allowed_tools
                ),
            }
        )
        SERVERS[server_id] = updated
        if changes.allowed_tools is not None:
            _sync_access(server_id, updated.allowed_tools)
        return updated

    def delete(self, server_id: str) -> bool:
        for key in [k for k in ACCESS if k[1] == server_id]:
            del ACCESS[key]
        return SERVERS.pop(server_id, None) is not None


def _entry(server: McpServer, allowed: Tools) -> AgentMcpServer:
    return AgentMcpServer(
        server_id=server.id,
        name=server.name,
        url=str(server.url),
        available_tools=list(server.allowed_tools),
        allowed_tools=list(allowed),
    )


class InMemoryAgentMcpRepository:
    def list(self, agent_id: str) -> list[AgentMcpServer]:
        return [
            _entry(SERVERS[server_id], tools)
            for (agent, server_id), tools in ACCESS.items()
            if agent == agent_id and server_id in SERVERS
        ]

    def put(self, agent_id: str, server: McpServer, tools: Tools) -> AgentMcpServer:
        ACCESS[(agent_id, server.id)] = list(tools)
        return _entry(server, tools)

    def delete(self, agent_id: str, server_id: str) -> bool:
        return ACCESS.pop((agent_id, server_id), None) is not None

    def counts(self) -> dict[str, int]:
        return dict(Counter(server_id for _, server_id in ACCESS))


class InMemoryMcpGrantLoader:
    def load(self, agent_id: str, key: str | None) -> list[McpGrant]:
        del key  # the caller is already authenticated
        return [
            McpGrant(id=e.server_id, name=e.name, url=e.url, allowed_tools=e.allowed_tools)
            for e in InMemoryAgentMcpRepository().list(agent_id)
        ]


# --- audit ---------------------------------------------------------------------------------------


def _new_session(agent_id: str, context_id: str, now: datetime) -> SessionCounters:
    return SessionCounters(
        agent_id=agent_id,
        context_id=context_id,
        turns=0,
        input_tokens=0,
        output_tokens=0,
        cost_usd=0.0,
        started_at=now,
        last_at=now,
    )


class InMemoryAuditRecorder:
    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None:
        now = datetime.now(UTC)
        current = MEMORY.sessions.get((agent_id, context_id)) or _new_session(
            agent_id, context_id, now
        )
        updated = current.model_copy(
            update={
                "turns": current.turns + 1,
                "input_tokens": current.input_tokens + max(input_tokens, 0),
                "output_tokens": current.output_tokens + max(output_tokens, 0),
                "cost_usd": current.cost_usd + max(cost_usd, 0.0),
                "last_at": now,
            }
        )
        MEMORY.sessions[(agent_id, context_id)] = updated
        return updated

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int:
        now = datetime.now(UTC)
        for event in events:
            MEMORY.events.append(
                AuditEvent(
                    **event.model_dump(),
                    id=str(uuid4()),
                    at=now,
                    agent_id=agent_id,
                    context_id=context_id,
                )
            )
        reason = stop_reason(events)
        if reason and context_id is not None:
            current = MEMORY.sessions.get((agent_id, context_id)) or _new_session(
                agent_id, context_id, now
            )
            MEMORY.sessions[(agent_id, context_id)] = current.model_copy(
                update={
                    "stopped_at": current.stopped_at or now,
                    "stop_reason": current.stop_reason or reason,
                    "last_at": now,
                }
            )
        return len(events)


class InMemoryAuditRepository:
    def events(self, filters: EventFilters) -> AuditEventPage:
        rows = [
            e
            for e in reversed(MEMORY.events)
            if (filters.agent_id is None or e.agent_id == filters.agent_id)
            and (filters.rule_id is None or e.rule_id == filters.rule_id)
            and (filters.action is None or e.action == filters.action)
            and (filters.kind is None or e.kind == filters.kind)
            and (filters.context_id is None or e.context_id == filters.context_id)
        ]
        if filters.before is not None:
            ids = [e.id for e in rows]
            _, last_id = filters.before
            rows = rows[ids.index(last_id) + 1 :] if last_id in ids else []
        page = rows[: filters.limit]
        more = len(rows) > filters.limit
        return AuditEventPage(data=page, next_cursor=event_cursor(page[-1]) if more else None)

    def rules(self) -> list[AuditRule]:
        seen = {
            e.rule_id: AuditRule(rule_id=e.rule_id, rule_name=e.rule_name, kind=e.kind)
            for e in MEMORY.events
        }
        return sorted_rules(seen)

    def sessions(self, filters: SessionFilters) -> SessionPage:
        counts = Counter((e.agent_id, e.context_id) for e in MEMORY.events)
        rows = sorted(MEMORY.sessions.values(), key=lambda s: s.last_at, reverse=True)
        rows = [
            s
            for s in rows
            if (filters.agent_id is None or s.agent_id == filters.agent_id)
            and (
                filters.status is None
                or (s.stopped_at is not None) == (filters.status == "stopped")
            )
        ]
        page = rows[filters.offset : filters.offset + filters.limit]
        end = filters.offset + len(page)
        return SessionPage(
            data=[with_limits(s, None, counts[(s.agent_id, s.context_id)]) for s in page],
            next_cursor=cursor.encode([str(end)]) if end < len(rows) else None,
        )


# --- security scans ------------------------------------------------------------------------------


class InMemoryScanRepository:
    def save(self, scan: ScanRecord) -> None:
        SCANS[scan.id] = scan

    def list_for_agent(self, agent_id: str) -> list[ScanListItem]:
        scans = sorted(
            (s for s in SCANS.values() if s.agent_id == agent_id),
            key=lambda s: s.created_at,
            reverse=True,
        )
        return [ScanListItem.model_validate(s.model_dump()) for s in scans[:HISTORY_LIMIT]]

    def get(self, scan_id: str) -> ScanRecord | None:
        return SCANS.get(scan_id)


class InMemoryProfileRepository:
    def done(self) -> set[Step]:
        return set(PROFILE)

    def mark(self, step: Step) -> None:
        PROFILE.add(step)


# --- wiring --------------------------------------------------------------------------------------


def use_fakes(app: FastAPI) -> None:
    """Run every route as the fake owner, on the in-memory stores."""
    overrides: dict[Any, Any] = {
        get_current_user: fake_user,
        get_guardrail_repository: InMemoryGuardrailRepository,
        get_signature_repository: InMemorySignatureRepository,
        get_binding_repository: InMemoryBindingRepository,
        get_mcp_server_repository: InMemoryMcpServerRepository,
        get_agent_mcp_repository: InMemoryAgentMcpRepository,
        get_audit_repository: InMemoryAuditRepository,
        get_scan_repository: InMemoryScanRepository,
        get_profile_repository: InMemoryProfileRepository,
        get_policy_loader: CatalogPolicyLoader,
        get_audit_recorder: InMemoryAuditRecorder,
        get_gateway_mcp_loader: InMemoryMcpGrantLoader,
        gateway_router.get_signature_loader: InMemorySignatureLoader,
        test_chat.get_test_chat_recorder: InMemoryAuditRecorder,
        test_chat.get_test_chat_mcp_loader: InMemoryMcpGrantLoader,
    }
    app.dependency_overrides.update(overrides)
