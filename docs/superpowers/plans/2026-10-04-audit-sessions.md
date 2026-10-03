# Audit Log and Sessions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A-07 (audit + session storage, recorder and read API, gateway counting turns) and D-06
(Sessions and Audit log screens in the panel).

**Architecture:** Two Supabase tables written only through `security definer` functions keyed by
the gateway key hash (same pattern as `gateway_resolve_agent`), read by signed-in owners through
RLS. The API exposes a write-side `AuditRecorder` (gateway, later B-02/B-05/B-06) and a read-side
`AuditRepository` (routes), each with an in-memory and a Supabase implementation. The panel reads
the routes with TanStack `useInfiniteQuery`.

**Tech Stack:** FastAPI + Pydantic v2 + supabase-py (apps/api, own uv project), Postgres/Supabase
migrations, React 19 + TanStack Query v5 + react-router + Tailwind v4 + Vitest/MSW (apps/web).

**Spec:** `docs/superpowers/specs/2026-10-04-audit-sessions-design.md`

## Global Constraints

- No message content is stored anywhere: sessions hold counters, audit events hold rule ids and a
  short reason (`details` ≤ 500 chars).
- Every API route under `/api/v1`; Pydantic models for bodies; storage = Protocol + in-memory +
  Supabase; routes depend on the Protocol only.
- A new column means three edits: migration, the repository's column list, the Pydantic model.
- RLS on for every table; `authenticated` reads only rows of agents it owns; nobody but the
  `security definer` functions writes.
- Event filters: `agent_id`, `rule_id`, `action` (`block|redact|warn`), `kind` (`guardrail|limit`),
  `context_id`; `limit` 1–200, default 50; newest first; opaque `before` cursor.
- Session `limits` is always `[]` until B-05. Cost is 0 until B-05 prices calls.
- Recording failures are logged and swallowed; they never change the gateway's response.
- Web: pnpm only, TypeScript only, relative `/api/v1/...` URLs.
- Panel copy (exact): "No sessions yet. Calls through an agent's guarded URL show up here.",
  "No events match these filters.", "No audit events yet. Blocks, redactions, warnings and limit
  hits appear here.", "The audit API isn't available on this server yet (A-07)."

## Review Focus

1. A gateway call whose reply has no `metadata.usage`, or a non-numeric/negative one → counted
   with 0 tokens, never a 500. (Task 4 test.)
2. A `contextId` with `|`, `,` or parentheses → the cursor still round-trips (JSON in base64url,
   not a delimiter) and the PostgREST `or` filter is never built from it (Task 3 test).
3. A garbage or truncated `before` cursor → 422, not 500 (Task 3 test).
4. The recorder raising (storage down) after a successful upstream reply → the client still gets
   the agent's reply byte for byte (Task 4 test).
5. Deleting an agent → its sessions and events go with it (FK cascade, Task 1 PGlite check).

---

## File structure

API (`apps/api`):

- Create `supabase/migrations/20261004090000_audit_and_sessions.sql` — tables, RLS, the two
  gateway functions.
- Create `app/audit/__init__.py` (empty).
- Create `app/audit/models.py` — Pydantic models + filter dataclasses.
- Create `app/audit/cursor.py` — opaque cursor encode/decode.
- Create `app/audit/memory.py` — the shared in-memory store + reset.
- Create `app/audit/recorder.py` — `AuditRecorder` Protocol, in-memory + Supabase, dependency.
- Create `app/audit/repository.py` — `AuditRepository` Protocol, in-memory + Supabase, dependency.
- Create `app/api/routes/audit.py` — the three GET routes.
- Modify `app/api/main.py` — include the router.
- Modify `app/gateway/router.py` — record a turn after a forward.
- Modify `tests/conftest.py` — reset the in-memory audit store.
- Create `tests/test_audit_recorder.py`, `tests/test_audit_api.py`; modify `tests/test_gateway.py`.

Docs: modify `docs/api-contract-agents.md`.

Web (`apps/web`):

- Modify `src/api/types.ts` — audit and session types.
- Create `src/api/audit.ts` — hooks.
- Create `src/ui/format.ts` — time, duration, cost, short id formatting.
- Modify `src/test/fakeApi.ts` — seeds + handlers (needed by every test that lands on `/sessions`).
- Create `src/pages/audit/AuditLogPage.tsx`, `src/pages/audit/AuditLogPage.test.tsx`.
- Create `src/pages/sessions/SessionsPage.tsx`, `src/pages/sessions/SessionsPage.test.tsx`.
- Create `src/pages/ApiUnavailable.tsx` — shared load-error block.
- Modify `src/app/AppRoutes.tsx` — map `/sessions` and `/audit`.

---

### Task 1: Migration — tables, RLS and gateway functions

**Files:**
- Create: `apps/api/supabase/migrations/20261004090000_audit_and_sessions.sql`
- Check: a scratch PGlite script (not committed)

**Interfaces:**
- Produces: tables `public.agent_sessions`, `public.audit_events`; functions
  `public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric) returns setof agent_sessions`,
  `public.gateway_record_events(uuid, text, text, jsonb) returns integer`.

- [ ] **Step 1: Write the migration**

```sql
-- A-07: audit events and session counters (FR-28, FR-36). No message content is ever stored.
-- Written only by the gateway through the security definer functions below (it runs without a
-- signed-in user and proves itself with the agent's gateway key hash, like gateway_resolve_agent).
-- Read by signed-in users for the agents they own.

create table public.agent_sessions (
    agent_id uuid not null references public.agents (id) on delete cascade,
    context_id text not null,
    turns integer not null default 0,
    input_tokens bigint not null default 0,
    output_tokens bigint not null default 0,
    cost_usd numeric(12, 6) not null default 0,
    started_at timestamp with time zone not null default now(),
    last_at timestamp with time zone not null default now(),
    stopped_at timestamp with time zone,
    stop_reason text,

    primary key (agent_id, context_id),
    constraint agent_sessions_context_id_check
        check (char_length(context_id) between 1 and 200),
    constraint agent_sessions_counters_check
        check (turns >= 0 and input_tokens >= 0 and output_tokens >= 0 and cost_usd >= 0)
);

comment on table public.agent_sessions is
    'One A2A conversation (contextId) per agent: counters only, no content (FR-36).';

create index agent_sessions_last_at_idx on public.agent_sessions (last_at desc);

create table public.audit_events (
    id uuid primary key default gen_random_uuid(),
    at timestamp with time zone not null default now(),
    agent_id uuid not null references public.agents (id) on delete cascade,
    context_id text,
    rule_id text not null,
    rule_name text not null,
    kind text not null,
    stage text,
    action text not null,
    config_version text,
    details text not null default '',

    constraint audit_events_kind_check check (kind in ('guardrail', 'limit')),
    constraint audit_events_stage_check check (stage is null or stage in ('input', 'output')),
    constraint audit_events_action_check check (action in ('block', 'redact', 'warn')),
    constraint audit_events_rule_check
        check (char_length(rule_id) between 1 and 200 and char_length(rule_name) between 1 and 200),
    constraint audit_events_details_check check (char_length(details) <= 500),
    constraint audit_events_context_id_check
        check (context_id is null or char_length(context_id) between 1 and 200)
);

comment on table public.audit_events is
    'Every guardrail or limit hit (block, redact, warn), keyed by rule id (FR-28). No content.';

create index audit_events_at_idx on public.audit_events (at desc, id desc);
create index audit_events_agent_at_idx on public.audit_events (agent_id, at desc);
create index audit_events_context_idx on public.audit_events (context_id);

alter table public.agent_sessions enable row level security;
alter table public.audit_events enable row level security;

create policy "Owners can read their agents' sessions"
on public.agent_sessions
for select
to authenticated
using (
    exists (
        select 1 from public.agents as a
        where a.id = agent_sessions.agent_id and a.owner_id = (select auth.uid())
    )
);

create policy "Owners can read their agents' audit events"
on public.audit_events
for select
to authenticated
using (
    exists (
        select 1 from public.agents as a
        where a.id = audit_events.agent_id and a.owner_id = (select auth.uid())
    )
);

revoke all on table public.agent_sessions from anon, authenticated;
revoke all on table public.audit_events from anon, authenticated;
grant select on table public.agent_sessions to authenticated;
grant select on table public.audit_events to authenticated;
grant all on table public.agent_sessions to service_role;
grant all on table public.audit_events to service_role;

-- One more turn in a session (created on its first turn). Returns the counters after the update,
-- or no row when the key is wrong.
create function public.gateway_record_turn(
    p_agent_id uuid,
    p_key_hash text,
    p_context_id text,
    p_input_tokens bigint,
    p_output_tokens bigint,
    p_cost_usd numeric
)
returns setof public.agent_sessions
language plpgsql
security definer
set search_path = ''
as $$
begin
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id
          and a.gateway_key_hash is not null
          and a.gateway_key_hash = p_key_hash
    ) then
        return;
    end if;

    return query
    insert into public.agent_sessions as s
        (agent_id, context_id, turns, input_tokens, output_tokens, cost_usd)
    values (
        p_agent_id, p_context_id, 1,
        greatest(p_input_tokens, 0), greatest(p_output_tokens, 0), greatest(p_cost_usd, 0)
    )
    on conflict (agent_id, context_id) do update
        set turns = s.turns + 1,
            input_tokens = s.input_tokens + excluded.input_tokens,
            output_tokens = s.output_tokens + excluded.output_tokens,
            cost_usd = s.cost_usd + excluded.cost_usd,
            last_at = now()
    returning s.*;
end;
$$;

comment on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric) is
    'Gateway (A-07): count one turn of a session, only when the key hash matches.';

-- Audit events for one call. A limit block also stops the session (FR-36: "shows it as stopped").
-- Returns how many events were stored (0 when the key is wrong).
create function public.gateway_record_events(
    p_agent_id uuid,
    p_key_hash text,
    p_context_id text,
    p_events jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
    inserted integer;
    stop_details text;
begin
    if not exists (
        select 1 from public.agents as a
        where a.id = p_agent_id
          and a.gateway_key_hash is not null
          and a.gateway_key_hash = p_key_hash
    ) then
        return 0;
    end if;
    if jsonb_typeof(p_events) <> 'array' then
        raise exception 'p_events must be a JSON array' using errcode = '22023';
    end if;

    insert into public.audit_events
        (agent_id, context_id, rule_id, rule_name, kind, stage, action, config_version, details)
    select
        p_agent_id, p_context_id, e ->> 'rule_id', e ->> 'rule_name', e ->> 'kind',
        e ->> 'stage', e ->> 'action', e ->> 'config_version', coalesce(e ->> 'details', '')
    from jsonb_array_elements(p_events) as e;
    get diagnostics inserted = row_count;

    if p_context_id is not null then
        select e ->> 'details' into stop_details
        from jsonb_array_elements(p_events) as e
        where e ->> 'kind' = 'limit' and e ->> 'action' = 'block'
        limit 1;
        if found then
            insert into public.agent_sessions as s (agent_id, context_id, stopped_at, stop_reason)
            values (
                p_agent_id, p_context_id, now(), coalesce(nullif(stop_details, ''), 'Limit reached')
            )
            on conflict (agent_id, context_id) do update
                set stopped_at = coalesce(s.stopped_at, now()),
                    stop_reason = coalesce(s.stop_reason, excluded.stop_reason),
                    last_at = now();
        end if;
    end if;

    return inserted;
end;
$$;

comment on function public.gateway_record_events(uuid, text, text, jsonb) is
    'Gateway (A-07): store audit events for a call, only when the key hash matches.';

revoke all on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric)
    from public;
revoke all on function public.gateway_record_events(uuid, text, text, jsonb) from public;
grant execute on function public.gateway_record_turn(uuid, text, text, bigint, bigint, numeric)
    to anon, authenticated;
grant execute on function public.gateway_record_events(uuid, text, text, jsonb)
    to anon, authenticated;
```

- [ ] **Step 2: Check it in PGlite**

Scratch dir with `@electric-sql/pglite` (`pnpm add @electric-sql/pglite` in the scratchpad), then
`run.mjs` (MIGRATIONS = absolute path of `apps/api/supabase/migrations`):

```js
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
const dir = process.env.MIGRATIONS
const db = new PGlite()
await db.exec(`
  create schema auth; create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create role anon; create role authenticated; create role service_role;
  grant usage on schema auth to anon, authenticated;`)
for (const f of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await db.exec(readFileSync(`${dir}/${f}`, 'utf8')); console.log('applied', f)
}
await db.exec(`grant usage on schema public to anon, authenticated;
  insert into auth.users values ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
  insert into public.agents (id, owner_id, name, base_url, upstream_url, gateway_key_hash) values
   ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'A', 'https://a.example', 'https://a.example/rpc', repeat('a', 64)),
   ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'B', 'https://b.example', 'https://b.example/rpc', repeat('b', 64));`)
const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const q = async (sql) => (await db.query(sql)).rows
console.log('wrong key turn', await q(`select * from public.gateway_record_turn('${A}', repeat('x',64), 'ctx-1', 5, 3, 0)`))
console.log('turn 1', await q(`select turns, input_tokens from public.gateway_record_turn('${A}', repeat('a',64), 'ctx-1', 5, 3, 0)`))
console.log('turn 2', await q(`select turns, input_tokens, output_tokens from public.gateway_record_turn('${A}', repeat('a',64), 'ctx-1', 2, 1, 0)`))
console.log('events', await q(`select public.gateway_record_events('${A}', repeat('a',64), 'ctx-1',
  '[{"rule_id":"g-pii","rule_name":"PII","kind":"guardrail","stage":"output","action":"redact","details":"email"},
    {"rule_id":"maxSessionTokens","rule_name":"Session tokens","kind":"limit","action":"block","details":"Session token cap reached"}]') as n`))
console.log('stopped', await q(`select stopped_at is not null as stopped, stop_reason from public.agent_sessions`))
try { await db.exec(`select public.gateway_record_events('${A}', repeat('a',64), null, '[{"rule_id":"x","rule_name":"x","kind":"bad","action":"block"}]')`); console.log('bad kind accepted!') }
catch (e) { console.log('bad kind rejected') }
await db.exec(`set role authenticated; set test.uid = '22222222-2222-2222-2222-222222222222'`)
console.log('other owner sees', await q(`select count(*) from public.audit_events`), await q(`select count(*) from public.agent_sessions`))
await db.exec(`set test.uid = '11111111-1111-1111-1111-111111111111'`)
console.log('owner sees', await q(`select count(*) from public.audit_events`), await q(`select count(*) from public.agent_sessions`))
try { await db.exec(`insert into public.audit_events (agent_id, rule_id, rule_name, kind, action) values ('${A}','x','x','guardrail','warn')`); console.log('insert allowed!') }
catch (e) { console.log('insert denied') }
await db.exec(`reset role; delete from public.agents where id = '${A}'`)
console.log('after agent delete', await q(`select count(*) from public.audit_events`), await q(`select count(*) from public.agent_sessions`))
```

Run: `MIGRATIONS=$PWD/apps/api/supabase/migrations node run.mjs` (from the scratch dir, path absolute).
Expected: every migration applied; wrong key → `[]`; turn 1 → turns 1, input 5; turn 2 → turns 2,
input 7, output 4; events → 2; stopped → true with "Session token cap reached"; bad kind rejected;
other owner sees 0 and 0; owner sees 2 and 1; insert denied; after agent delete 0 and 0.

- [ ] **Step 3: Commit**

```bash
git add apps/api/supabase/migrations/20261004090000_audit_and_sessions.sql
git commit -m "feat(api): audit events and session counters tables (A-07)"
```

---

### Task 2: Models, cursor, in-memory store and the recorder

**Files:**
- Create: `apps/api/app/audit/__init__.py`, `models.py`, `cursor.py`, `memory.py`, `recorder.py`
- Modify: `apps/api/tests/conftest.py`
- Test: `apps/api/tests/test_audit_recorder.py`

**Interfaces:**
- Produces (`app.audit.models`): `Kind = Literal["guardrail","limit"]`,
  `Stage = Literal["input","output"]`, `Action = Literal["block","redact","warn"]`,
  `AuditEventIn`, `AuditEvent`, `AuditEventPage`, `AuditRule`, `SessionLimit`, `SessionCounters`,
  `Session`, `SessionPage`, `EventFilters`, `SessionFilters`.
- Produces (`app.audit.cursor`): `encode(parts: list[str]) -> str`, `decode(cursor: str, size: int) -> list[str]` (raises `ValueError`).
- Produces (`app.audit.memory`): `MEMORY: MemoryAudit` with `.sessions: dict[tuple[str, str], SessionCounters]`, `.events: list[AuditEvent]`; `reset_in_memory_audit() -> None`.
- Produces (`app.audit.recorder`): `AuditRecorder` Protocol
  `record_turn(agent_id: str, key: str, context_id: str, input_tokens: int, output_tokens: int, cost_usd: float) -> SessionCounters | None`,
  `record_events(agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]) -> int`;
  `InMemoryAuditRecorder`, `SupabaseAuditRecorder(client)`, `get_audit_recorder() -> AuditRecorder`.

- [ ] **Step 1: Write the failing tests** (`tests/test_audit_recorder.py`)

```python
"""A-07 write side: counting turns and storing audit events (in memory; SQL twin in the migration)."""

from unittest.mock import MagicMock

from app.audit.memory import MEMORY
from app.audit.models import AuditEventIn
from app.audit.recorder import InMemoryAuditRecorder, SupabaseAuditRecorder
from app.gateway.keys import hash_key

AGENT = "7b4eb987-4315-4745-83c7-258061f2f2c4"


def pii(action: str = "redact") -> AuditEventIn:
    return AuditEventIn(
        rule_id="g-pii",
        rule_name="PII",
        kind="guardrail",
        stage="output",
        action=action,
        details="email address",
    )


def session_cap() -> AuditEventIn:
    return AuditEventIn(
        rule_id="maxSessionTokens",
        rule_name="Session tokens",
        kind="limit",
        action="block",
        details="Session token cap reached",
    )


def test_first_turn_creates_the_session_and_later_turns_add_up() -> None:
    recorder = InMemoryAuditRecorder()
    first = recorder.record_turn(AGENT, "key", "ctx-1", 10, 4, 0.0)
    second = recorder.record_turn(AGENT, "key", "ctx-1", 5, 1, 0.0)
    assert first is not None and first.turns == 1
    assert second is not None
    assert (second.turns, second.input_tokens, second.output_tokens) == (2, 15, 5)
    assert second.last_at >= first.started_at
    assert second.stopped_at is None


def test_negative_tokens_count_as_zero() -> None:
    counters = InMemoryAuditRecorder().record_turn(AGENT, "key", "ctx-1", -3, -1, -0.5)
    assert counters is not None
    assert (counters.input_tokens, counters.output_tokens, counters.cost_usd) == (0, 0, 0.0)


def test_events_are_stored_newest_last() -> None:
    stored = InMemoryAuditRecorder().record_events(AGENT, "key", "ctx-1", [pii(), pii("warn")])
    assert stored == 2
    assert [e.action for e in MEMORY.events] == ["redact", "warn"]
    assert all(e.agent_id == AGENT and e.context_id == "ctx-1" for e in MEMORY.events)


def test_a_limit_block_stops_the_session_with_its_reason() -> None:
    recorder = InMemoryAuditRecorder()
    recorder.record_turn(AGENT, "key", "ctx-1", 1, 1, 0.0)
    recorder.record_events(AGENT, "key", "ctx-1", [session_cap()])
    session = MEMORY.sessions[(AGENT, "ctx-1")]
    assert session.stopped_at is not None
    assert session.stop_reason == "Session token cap reached"


def test_a_guardrail_block_or_a_limit_warning_does_not_stop_the_session() -> None:
    recorder = InMemoryAuditRecorder()
    recorder.record_turn(AGENT, "key", "ctx-1", 1, 1, 0.0)
    warn = session_cap().model_copy(update={"action": "warn"})
    recorder.record_events(AGENT, "key", "ctx-1", [pii("block"), warn])
    assert MEMORY.sessions[(AGENT, "ctx-1")].stopped_at is None


def test_supabase_recorder_sends_only_the_key_hash() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = [
        {
            "agent_id": AGENT,
            "context_id": "ctx-1",
            "turns": 1,
            "input_tokens": 3,
            "output_tokens": 2,
            "cost_usd": 0,
            "started_at": "2026-10-04T10:00:00+00:00",
            "last_at": "2026-10-04T10:00:00+00:00",
            "stopped_at": None,
            "stop_reason": None,
        }
    ]
    counters = SupabaseAuditRecorder(client).record_turn(AGENT, "secret-key", "ctx-1", 3, 2, 0.0)
    name, params = client.rpc.call_args.args
    assert name == "gateway_record_turn"
    assert params["p_key_hash"] == hash_key("secret-key")
    assert "secret-key" not in str(params)
    assert counters is not None and counters.turns == 1


def test_supabase_recorder_sends_events_as_json() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = 1
    assert SupabaseAuditRecorder(client).record_events(AGENT, "k", None, [pii()]) == 1
    name, params = client.rpc.call_args.args
    assert name == "gateway_record_events"
    assert params["p_events"][0]["rule_id"] == "g-pii"
    assert params["p_context_id"] is None
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/api && uv run pytest tests/test_audit_recorder.py -q`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.audit'`.

- [ ] **Step 3: Implement**

`app/audit/__init__.py`: empty file.

`app/audit/models.py`:

```python
"""A-07 models: audit events (FR-28) and session counters (FR-36). No message content."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

Kind = Literal["guardrail", "limit"]
Stage = Literal["input", "output"]
Action = Literal["block", "redact", "warn"]
SessionStatus = Literal["active", "stopped"]


class AuditEventIn(BaseModel):
    """What a reporter (B-02 pipeline, B-05 limits, B-06 test chat) sends for one hit."""

    rule_id: str = Field(min_length=1, max_length=200)
    rule_name: str = Field(min_length=1, max_length=200)
    kind: Kind
    stage: Stage | None = None
    action: Action
    config_version: str | None = None
    details: str = Field(default="", max_length=500)  # the reason, never message text


class AuditEvent(AuditEventIn):
    id: str
    at: datetime
    agent_id: str
    agent_name: str | None = None
    context_id: str | None = None


class AuditEventPage(BaseModel):
    data: list[AuditEvent]
    next_cursor: str | None


class AuditRule(BaseModel):
    rule_id: str
    rule_name: str
    kind: Kind


class SessionLimit(BaseModel):
    name: str
    used: float
    max: float
    unit: str | None = None


class SessionCounters(BaseModel):
    agent_id: str
    context_id: str
    turns: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    started_at: datetime
    last_at: datetime
    stopped_at: datetime | None = None
    stop_reason: str | None = None


class Session(BaseModel):
    agent_id: str
    agent_name: str | None = None
    context_id: str
    turns: int
    input_tokens: int
    output_tokens: int
    cost_usd: float
    started_at: datetime
    last_at: datetime
    duration_seconds: float
    status: SessionStatus
    stop_reason: str | None = None
    events: int
    limits: list[SessionLimit] = Field(default_factory=list)  # filled by B-05


class SessionPage(BaseModel):
    data: list[Session]
    next_cursor: str | None


@dataclass(frozen=True)
class EventFilters:
    agent_id: str | None = None
    rule_id: str | None = None
    action: Action | None = None
    kind: Kind | None = None
    context_id: str | None = None
    limit: int = 50
    before: tuple[datetime, str] | None = None  # (at, id) of the last event already shown


@dataclass(frozen=True)
class SessionFilters:
    agent_id: str | None = None
    status: SessionStatus | None = None
    limit: int = 50
    offset: int = 0


def to_session(counters: SessionCounters, agent_name: str | None, events: int) -> Session:
    return Session(
        **counters.model_dump(exclude={"stopped_at"}),
        agent_name=agent_name,
        duration_seconds=max((counters.last_at - counters.started_at).total_seconds(), 0.0),
        status="stopped" if counters.stopped_at else "active",
        events=events,
    )
```

`app/audit/cursor.py`:

```python
"""Opaque paging cursors: a JSON list of strings in base64url, so ids may hold any character."""

import base64
import binascii
import json


def encode(parts: list[str]) -> str:
    return base64.urlsafe_b64encode(json.dumps(parts).encode()).decode().rstrip("=")


def decode(cursor: str, size: int) -> list[str]:
    """The cursor's parts; ValueError when it wasn't made by encode() with `size` parts."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        parts = json.loads(raw)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid cursor") from error
    if (
        not isinstance(parts, list)
        or len(parts) != size
        or not all(isinstance(p, str) for p in parts)
    ):
        raise ValueError("Invalid cursor")
    return parts
```

`app/audit/memory.py`:

```python
"""In-memory audit store, used without Supabase (local runs, tests). Shared by recorder and reads."""

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
```

`app/audit/recorder.py`:

```python
"""A-07 write side. The gateway counts turns; B-02/B-05/B-06 report guardrail and limit hits.

Supabase: the gateway has no signed-in user, so it calls security definer functions with the
agent's gateway key hash (see the audit_and_sessions migration), like gateway_resolve_agent.
In memory (no Supabase): the caller already checked the key, so it isn't checked again.
"""

from datetime import UTC, datetime
from typing import Any, Protocol, cast
from uuid import uuid4

from app.audit.memory import MEMORY
from app.audit.models import AuditEvent, AuditEventIn, SessionCounters
from app.core.config import settings
from app.core.supabase import get_supabase
from app.gateway.keys import hash_key
from supabase import Client

LIMIT_REACHED = "Limit reached"


class AuditRecorder(Protocol):
    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None: ...

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int: ...


def _stop_reason(events: list[AuditEventIn]) -> str | None:
    for event in events:
        if event.kind == "limit" and event.action == "block":
            return event.details or LIMIT_REACHED
    return None


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
        current = MEMORY.sessions.get((agent_id, context_id))
        if current is None:
            current = SessionCounters(
                agent_id=agent_id,
                context_id=context_id,
                turns=0,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                started_at=now,
                last_at=now,
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
        reason = _stop_reason(events)
        if reason and context_id is not None:
            current = MEMORY.sessions.get((agent_id, context_id)) or SessionCounters(
                agent_id=agent_id,
                context_id=context_id,
                turns=0,
                input_tokens=0,
                output_tokens=0,
                cost_usd=0.0,
                started_at=now,
                last_at=now,
            )
            MEMORY.sessions[(agent_id, context_id)] = current.model_copy(
                update={
                    "stopped_at": current.stopped_at or now,
                    "stop_reason": current.stop_reason or reason,
                    "last_at": now,
                }
            )
        return len(events)


class SupabaseAuditRecorder:
    """Raises on storage errors; the gateway logs and ignores them."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def record_turn(
        self,
        agent_id: str,
        key: str,
        context_id: str,
        input_tokens: int,
        output_tokens: int,
        cost_usd: float,
    ) -> SessionCounters | None:
        data = (
            self._client.rpc(
                "gateway_record_turn",
                {
                    "p_agent_id": agent_id,
                    "p_key_hash": hash_key(key),
                    "p_context_id": context_id,
                    "p_input_tokens": input_tokens,
                    "p_output_tokens": output_tokens,
                    "p_cost_usd": cost_usd,
                },
            )
            .execute()
            .data
        )
        rows = cast(list[dict[str, Any]], data or [])
        return SessionCounters.model_validate(rows[0]) if rows else None

    def record_events(
        self, agent_id: str, key: str, context_id: str | None, events: list[AuditEventIn]
    ) -> int:
        if not events:
            return 0
        data = (
            self._client.rpc(
                "gateway_record_events",
                {
                    "p_agent_id": agent_id,
                    "p_key_hash": hash_key(key),
                    "p_context_id": context_id,
                    "p_events": [event.model_dump() for event in events],
                },
            )
            .execute()
            .data
        )
        return data if isinstance(data, int) else 0


def get_audit_recorder() -> AuditRecorder:
    """FastAPI dependency for the gateway."""
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        return SupabaseAuditRecorder(get_supabase())
    return InMemoryAuditRecorder()
```

`tests/conftest.py`: import `reset_in_memory_audit` next to `reset_in_memory_servers` and call it
in `fresh_store()`:

```python
from app.audit.memory import reset_in_memory_audit  # noqa: E402  (needs the path above)

...


def fresh_store() -> None:
    reset_store()
    reset_in_memory_servers()
    reset_in_memory_audit()
```

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && uv run pytest tests/test_audit_recorder.py -q`
Expected: 7 passed. Then `uv run ruff format app tests && uv run ruff check app tests` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/audit apps/api/tests/conftest.py apps/api/tests/test_audit_recorder.py
git commit -m "feat(api): audit recorder for session turns and guardrail/limit hits (A-07)"
```

---

### Task 3: Read repository and routes

**Files:**
- Create: `apps/api/app/audit/repository.py`, `apps/api/app/api/routes/audit.py`
- Modify: `apps/api/app/api/main.py`
- Test: `apps/api/tests/test_audit_api.py`

**Interfaces:**
- Consumes: Task 2 models, `cursor.encode/decode`, `MEMORY`, `InMemoryAuditRecorder` (tests).
- Produces: `AuditRepository` Protocol `events(filters: EventFilters) -> AuditEventPage`,
  `rules() -> list[AuditRule]`, `sessions(filters: SessionFilters) -> SessionPage`;
  `get_audit_repository` dependency; routes `GET /api/v1/audit-events`,
  `GET /api/v1/audit-events/rules`, `GET /api/v1/sessions`.

Event cursor = `encode([at.isoformat(), id])` of the last row returned. Session cursor =
`encode([str(offset)])` (sessions move to the top as they get new turns, so a keyset would need
three columns including a free-text `context_id`; an offset is enough for this screen).

- [ ] **Step 1: Write the failing tests** (`tests/test_audit_api.py`)

```python
"""A-07 read API: audit events with filters and paging, rules, sessions."""

import pytest
from app.audit.models import AuditEventIn
from app.audit.recorder import InMemoryAuditRecorder
from app.core.config import settings
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
SUPPORT = "7b4eb987-4315-4745-83c7-258061f2f2c4"
CONTRACTS = "0b9a3a3e-8f39-4b55-9a5e-1d1c2b3a4f5e"


def hit(rule_id: str, action: str, kind: str = "guardrail") -> AuditEventIn:
    return AuditEventIn(
        rule_id=rule_id,
        rule_name=rule_id.upper(),
        kind=kind,
        action=action,
        stage="input" if kind == "guardrail" else None,
        details=f"{rule_id} {action}",
    )


@pytest.fixture
def events() -> None:
    r = InMemoryAuditRecorder()
    r.record_events(SUPPORT, "k", "ctx-a", [hit("pii", "redact")])
    r.record_events(SUPPORT, "k", "ctx-a", [hit("inject", "block")])
    r.record_events(CONTRACTS, "k", "ctx-b", [hit("pii", "block")])
    r.record_events(SUPPORT, "k", "ctx|odd,(id)", [hit("maxSessionTokens", "block", "limit")])
    r.record_events(SUPPORT, "k", None, [hit("pii", "warn")])


def test_events_newest_first(events: None) -> None:
    body = client.get("/api/v1/audit-events").json()
    assert [e["details"] for e in body["data"]] == [
        "pii warn",
        "maxSessionTokens block",
        "pii block",
        "inject block",
        "pii redact",
    ]
    assert body["next_cursor"] is None


def test_filters_combine(events: None) -> None:
    r = client.get(
        "/api/v1/audit-events", params={"agent_id": SUPPORT, "rule_id": "pii", "action": "redact"}
    )
    assert [e["details"] for e in r.json()["data"]] == ["pii redact"]
    r = client.get("/api/v1/audit-events", params={"kind": "limit"})
    assert [e["rule_id"] for e in r.json()["data"]] == ["maxSessionTokens"]
    r = client.get("/api/v1/audit-events", params={"context_id": "ctx|odd,(id)"})
    assert len(r.json()["data"]) == 1


def test_paging_with_the_cursor_has_no_overlap(events: None) -> None:
    first = client.get("/api/v1/audit-events", params={"limit": 2}).json()
    assert len(first["data"]) == 2 and first["next_cursor"]
    second = client.get(
        "/api/v1/audit-events", params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    third = client.get(
        "/api/v1/audit-events", params={"limit": 2, "before": second["next_cursor"]}
    ).json()
    ids = [e["id"] for page in (first, second, third) for e in page["data"]]
    assert len(ids) == 5 and len(set(ids)) == 5
    assert third["next_cursor"] is None


@pytest.mark.parametrize("before", ["garbage", "W10", "WyJ4Il0"])
def test_a_bad_cursor_is_422(before: str) -> None:
    assert client.get("/api/v1/audit-events", params={"before": before}).status_code == 422


@pytest.mark.parametrize(
    "params", [{"limit": 0}, {"limit": 201}, {"action": "drop"}, {"kind": "x"}]
)
def test_bad_filters_are_422(params: dict[str, object]) -> None:
    assert client.get("/api/v1/audit-events", params=params).status_code == 422


def test_rules_are_distinct_and_grouped_by_kind(events: None) -> None:
    rules = client.get("/api/v1/audit-events/rules").json()
    assert rules == [
        {"rule_id": "inject", "rule_name": "INJECT", "kind": "guardrail"},
        {"rule_id": "pii", "rule_name": "PII", "kind": "guardrail"},
        {"rule_id": "maxSessionTokens", "rule_name": "MAXSESSIONTOKENS", "kind": "limit"},
    ]


def test_sessions_with_counters_status_and_event_count(events: None) -> None:
    r = InMemoryAuditRecorder()
    r.record_turn(SUPPORT, "k", "ctx-a", 10, 5, 0.0)
    r.record_turn(SUPPORT, "k", "ctx-a", 1, 1, 0.0)
    r.record_turn(CONTRACTS, "k", "ctx-b", 3, 3, 0.0)
    sessions = client.get("/api/v1/sessions").json()["data"]
    by_ctx = {s["context_id"]: s for s in sessions}
    assert by_ctx["ctx-a"]["turns"] == 2 and by_ctx["ctx-a"]["input_tokens"] == 11
    assert by_ctx["ctx-a"]["events"] == 2 and by_ctx["ctx-a"]["status"] == "active"
    assert by_ctx["ctx|odd,(id)"]["status"] == "stopped"
    assert by_ctx["ctx|odd,(id)"]["stop_reason"] == "maxSessionTokens block"
    assert by_ctx["ctx-a"]["limits"] == []
    assert sessions[0]["context_id"] == "ctx-b"  # most recent activity first


def test_session_filters_and_paging(events: None) -> None:
    r = InMemoryAuditRecorder()
    r.record_turn(SUPPORT, "k", "ctx-a", 1, 1, 0.0)
    r.record_turn(CONTRACTS, "k", "ctx-b", 1, 1, 0.0)
    stopped = client.get("/api/v1/sessions", params={"status": "stopped"}).json()["data"]
    assert [s["context_id"] for s in stopped] == ["ctx|odd,(id)"]
    mine = client.get("/api/v1/sessions", params={"agent_id": CONTRACTS}).json()["data"]
    assert [s["context_id"] for s in mine] == ["ctx-b"]
    first = client.get("/api/v1/sessions", params={"limit": 2}).json()
    rest = client.get(
        "/api/v1/sessions", params={"limit": 2, "before": first["next_cursor"]}
    ).json()
    assert len(first["data"]) == 2 and len(rest["data"]) == 1 and rest["next_cursor"] is None


def test_needs_a_token_with_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "publishable")
    for path in ("/api/v1/audit-events", "/api/v1/audit-events/rules", "/api/v1/sessions"):
        assert client.get(path).status_code == 401
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/api && uv run pytest tests/test_audit_api.py -q`
Expected: FAIL (404 on the routes / import errors).

- [ ] **Step 3: Implement**

`app/audit/repository.py`:

```python
"""A-07 read side: audit events, the rules seen in them, and sessions.

Same pattern as app/mcp/repository.py: Supabase with the signed-in user's token (RLS shows only
the caller's agents), or memory without Supabase (no owners there: everything is visible).
"""

from collections import Counter
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any, Protocol, TypeVar
from uuid import UUID

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.audit import cursor
from app.audit.memory import MEMORY
from app.audit.models import (
    AuditEvent,
    AuditEventPage,
    AuditRule,
    EventFilters,
    SessionCounters,
    SessionFilters,
    SessionPage,
    to_session,
)
from app.core.config import settings
from app.core.supabase import get_supabase_for_user
from supabase import Client

T = TypeVar("T")
_bearer = HTTPBearer(auto_error=False)

_EVENT_COLUMNS = (
    "id,at,agent_id,context_id,rule_id,rule_name,kind,stage,action,config_version,details,"
    "agents(name)"
)
_SESSION_COLUMNS = (
    "agent_id,context_id,turns,input_tokens,output_tokens,cost_usd,started_at,last_at,"
    "stopped_at,stop_reason,agents(name)"
)
_RULES_SCAN = 1000  # distinct rules are read from the newest events; plenty for a demo


class AuditRepository(Protocol):
    def events(self, filters: EventFilters) -> AuditEventPage: ...

    def rules(self) -> list[AuditRule]: ...

    def sessions(self, filters: SessionFilters) -> SessionPage: ...


def event_cursor(event: AuditEvent) -> str:
    return cursor.encode([event.at.isoformat(), event.id])


def _sorted_rules(rules: dict[str, AuditRule]) -> list[AuditRule]:
    return sorted(rules.values(), key=lambda r: (r.kind != "guardrail", r.rule_name.lower()))


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
        return _sorted_rules(seen)

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
            data=[to_session(s, None, counts[(s.agent_id, s.context_id)]) for s in page],
            next_cursor=cursor.encode([str(end)]) if end < len(rows) else None,
        )


def _agent_name(row: dict[str, Any]) -> str | None:
    agent = row.get("agents")
    return agent.get("name") if isinstance(agent, dict) else None


class SupabaseAuditRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    def _run(self, query: Callable[[], T]) -> T:
        try:
            return query()
        except APIError as error:
            if (error.code or "").startswith("PGRST3"):
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token"
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Audit storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Audit storage is unavailable"
            ) from error

    def events(self, filters: EventFilters) -> AuditEventPage:
        query = self._client.table("audit_events").select(_EVENT_COLUMNS)
        for column, value in (
            ("agent_id", filters.agent_id),
            ("rule_id", filters.rule_id),
            ("action", filters.action),
            ("kind", filters.kind),
            ("context_id", filters.context_id),
        ):
            if value is not None:
                query = query.eq(column, value)
        if filters.before is not None:
            at, last_id = filters.before
            stamp = at.isoformat()  # both values come from a decoded cursor: a timestamp and a uuid
            query = query.or_(f"at.lt.{stamp},and(at.eq.{stamp},id.lt.{last_id})")
        response = self._run(
            lambda: (
                query.order("at", desc=True)
                .order("id", desc=True)
                .limit(filters.limit + 1)
                .execute()
            )
        )
        rows = list(response.data)
        try:
            page = [
                AuditEvent.model_validate({**row, "agent_name": _agent_name(row)})
                for row in rows[: filters.limit]
            ]
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Stored audit event is invalid"
            ) from error
        more = len(rows) > filters.limit
        return AuditEventPage(data=page, next_cursor=event_cursor(page[-1]) if more else None)

    def rules(self) -> list[AuditRule]:
        response = self._run(
            lambda: (
                self._client.table("audit_events")
                .select("rule_id,rule_name,kind")
                .order("at", desc=True)
                .limit(_RULES_SCAN)
                .execute()
            )
        )
        seen: dict[str, AuditRule] = {}
        for row in response.data:
            seen.setdefault(row["rule_id"], AuditRule.model_validate(row))
        return _sorted_rules(seen)

    def sessions(self, filters: SessionFilters) -> SessionPage:
        query = self._client.table("agent_sessions").select(_SESSION_COLUMNS)
        if filters.agent_id is not None:
            query = query.eq("agent_id", filters.agent_id)
        if filters.status == "active":
            query = query.is_("stopped_at", "null")
        elif filters.status == "stopped":
            query = query.not_.is_("stopped_at", "null")
        response = self._run(
            lambda: (
                query.order("last_at", desc=True)
                .range(filters.offset, filters.offset + filters.limit)  # inclusive: one extra row
                .execute()
            )
        )
        rows = list(response.data)
        page_rows = rows[: filters.limit]
        counts: Counter[tuple[str, str]] = Counter()
        context_ids = sorted({row["context_id"] for row in page_rows})
        if context_ids:
            found = self._run(
                lambda: (
                    self._client.table("audit_events")
                    .select("agent_id,context_id")
                    .in_("context_id", context_ids)
                    .execute()
                )
            )
            counts = Counter((e["agent_id"], e["context_id"]) for e in found.data)
        sessions = [
            to_session(
                SessionCounters.model_validate(row),
                _agent_name(row),
                counts[(row["agent_id"], row["context_id"])],
            )
            for row in page_rows
        ]
        end = filters.offset + len(page_rows)
        return SessionPage(
            data=sessions,
            next_cursor=cursor.encode([str(end)]) if len(rows) > filters.limit else None,
        )


def get_audit_repository(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AuditRepository:
    if not (settings.SUPABASE_URL and settings.SUPABASE_KEY):
        return InMemoryAuditRepository()
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to see the audit log",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return SupabaseAuditRepository(get_supabase_for_user(credentials.credentials))


def parse_event_cursor(before: str | None) -> tuple[datetime, str] | None:
    if before is None:
        return None
    at, event_id = cursor.decode(before, 2)
    # Both parts end up in a PostgREST filter, so only a real timestamp and uuid get through.
    return datetime.fromisoformat(at), str(UUID(event_id))


def parse_session_cursor(before: str | None) -> int:
    if before is None:
        return 0
    (offset,) = cursor.decode(before, 1)
    value = int(offset)
    if value < 0:
        raise ValueError("Invalid cursor")
    return value
```

Note on the in-memory event ids: `InMemoryAuditRecorder` uses `uuid4()`, so `parse_event_cursor`'s
UUID check holds for both stores.

`app/api/routes/audit.py`:

```python
"""A-07: audit events (FR-28) and sessions (FR-36), read by the panel."""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.audit.models import (
    Action,
    AuditEventPage,
    AuditRule,
    EventFilters,
    Kind,
    SessionFilters,
    SessionPage,
    SessionStatus,
)
from app.audit.repository import (
    AuditRepository,
    get_audit_repository,
    parse_event_cursor,
    parse_session_cursor,
)

router = APIRouter(tags=["audit"])
Repo = Annotated[AuditRepository, Depends(get_audit_repository)]
Limit = Annotated[int, Query(ge=1, le=200)]


def _bad_cursor() -> HTTPException:
    return HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid cursor")


@router.get("/audit-events")
def list_audit_events(
    repo: Repo,
    agent_id: UUID | None = None,
    rule_id: str | None = None,
    action: Action | None = None,
    kind: Kind | None = None,
    context_id: str | None = None,
    limit: Limit = 50,
    before: str | None = None,
) -> AuditEventPage:
    try:
        cursor = parse_event_cursor(before)
    except ValueError as error:
        raise _bad_cursor() from error
    return repo.events(
        EventFilters(
            agent_id=str(agent_id) if agent_id else None,
            rule_id=rule_id,
            action=action,
            kind=kind,
            context_id=context_id,
            limit=limit,
            before=cursor,
        )
    )


@router.get("/audit-events/rules")
def list_audit_rules(repo: Repo) -> list[AuditRule]:
    return repo.rules()


@router.get("/sessions")
def list_sessions(
    repo: Repo,
    agent_id: UUID | None = None,
    status_: Annotated[SessionStatus | None, Query(alias="status")] = None,
    limit: Limit = 50,
    before: str | None = None,
) -> SessionPage:
    try:
        offset = parse_session_cursor(before)
    except ValueError as error:
        raise _bad_cursor() from error
    return repo.sessions(
        SessionFilters(
            agent_id=str(agent_id) if agent_id else None, status=status_, limit=limit, offset=offset
        )
    )
```

`app/api/main.py`: add `audit` to the routes import and `api_router.include_router(audit.router)`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && uv run pytest tests/test_audit_api.py tests/test_audit_recorder.py -q`
Expected: all pass. Then the full suite `uv run pytest -q` and `uv run ruff format --check . && uv run ruff check .` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/audit/repository.py apps/api/app/api/routes/audit.py apps/api/app/api/main.py apps/api/tests/test_audit_api.py
git commit -m "feat(api): audit events, rules and sessions endpoints (A-07)"
```

---

### Task 4: Gateway counts a turn after each forward

**Files:**
- Modify: `apps/api/app/gateway/router.py` (`forward_to_agent`)
- Test: `apps/api/tests/test_gateway.py`

**Interfaces:**
- Consumes: `AuditRecorder`, `get_audit_recorder`, `MEMORY` (tests).
- Produces: `usage_tokens(reply: dict[str, Any]) -> tuple[int, int]` in `app/gateway/a2a.py`.

- [ ] **Step 1: Write the failing tests** (append to `tests/test_gateway.py`; the module's
  `setup` fixture already installs `FakeResolver` and clears overrides; add an autouse fixture that
  forces the in-memory recorder so no test reaches Supabase)

```python
from app.audit.memory import MEMORY
from app.audit.recorder import InMemoryAuditRecorder, get_audit_recorder


@pytest.fixture(autouse=True)
def memory_recorder() -> None:
    app.dependency_overrides[get_audit_recorder] = InMemoryAuditRecorder


def with_context(context_id: str | None) -> dict[str, Any]:
    body = json.loads(json.dumps(SEND))
    if context_id is not None:
        body["params"]["message"]["contextId"] = context_id
    return body


def reply_with_usage(usage: object) -> Callable[[httpx.Request], httpx.Response]:
    def rpc(request: httpx.Request) -> httpx.Response:
        message = {
            "messageId": "r-1",
            "role": "ROLE_AGENT",
            "parts": [{"text": "ok"}],
            "metadata": {"usage": usage},
        }
        return httpx.Response(200, json={"jsonrpc": "2.0", "id": 1, "result": {"message": message}})

    return rpc


def test_a_forwarded_call_counts_a_turn_with_the_reply_usage() -> None:
    scripted_upstream(reply_with_usage({"inputTokens": 12, "outputTokens": 7}))
    assert post(with_context("ctx-1")).status_code == 200
    assert post(with_context("ctx-1")).status_code == 200
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.turns, session.input_tokens, session.output_tokens) == (2, 24, 14)


@pytest.mark.parametrize("usage", [None, "lots", {"inputTokens": "x"}, {"inputTokens": -5}])
def test_missing_or_bad_usage_counts_zero_tokens(usage: object) -> None:
    scripted_upstream(reply_with_usage(usage))
    assert post(with_context("ctx-1")).status_code == 200
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.turns, session.input_tokens, session.output_tokens) == (1, 0, 0)


def test_no_context_id_or_an_agent_error_records_nothing() -> None:
    scripted_upstream(reply_with_usage({"inputTokens": 1, "outputTokens": 1}))
    post(with_context(None))
    scripted_upstream(
        lambda r: httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32603, "message": "boom"}}
        )
    )
    post(with_context("ctx-err"))
    assert MEMORY.sessions == {}


def test_a_recorder_failure_does_not_change_the_reply() -> None:
    class Broken:
        def record_turn(self, *args: object) -> None:
            raise RuntimeError("storage down")

        def record_events(self, *args: object) -> int:
            raise RuntimeError("storage down")

    app.dependency_overrides[get_audit_recorder] = Broken
    scripted_upstream(reply_with_usage({"inputTokens": 1, "outputTokens": 1}))
    r = post(with_context("ctx-1"))
    assert r.status_code == 200
    assert r.json()["result"]["message"]["parts"] == [{"text": "ok"}]
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/api && uv run pytest tests/test_gateway.py -q -k "turn or usage or records_nothing or recorder"`
Expected: FAIL (no session recorded).

- [ ] **Step 3: Implement**

In `app/gateway/a2a.py`, add:

```python
def usage_tokens(reply: dict[str, Any]) -> tuple[int, int]:
    """(input, output) tokens from the reply's metadata.usage (profile §usage), else (0, 0)."""
    result = reply.get("result")
    if not isinstance(result, dict):
        return 0, 0
    holder = (
        result.get("message") if isinstance(result.get("message"), dict) else result.get("task")
    )
    metadata = holder.get("metadata") if isinstance(holder, dict) else None
    usage = metadata.get("usage") if isinstance(metadata, dict) else None
    if not isinstance(usage, dict):
        return 0, 0

    def count(name: str) -> int:
        value = usage.get(name)
        return (
            max(int(value), 0)
            if isinstance(value, int | float) and not isinstance(value, bool)
            else 0
        )

    return count("inputTokens"), count("outputTokens")
```

In `app/gateway/router.py`: import `logging`, `AuditRecorder`, `get_audit_recorder`; add
`logger = logging.getLogger(__name__)`; add the parameter
`recorder: Annotated[AuditRecorder, Depends(get_audit_recorder)],` to `forward_to_agent`; and
just before the final `return Response(...)`:

```python
    # A-07: count the turn (no content). A recording failure never changes the agent's reply.
    context_id = params["message"].get("contextId")
    if "error" not in reply and isinstance(context_id, str) and context_id:
        input_tokens, output_tokens = a2a.usage_tokens(reply)
        try:
            await run_in_threadpool(
                recorder.record_turn, agent_id, key, context_id, input_tokens, output_tokens, 0.0
            )
        except Exception:  # noqa: BLE001 - audit storage must not break a successful call
            logger.warning("Could not record a turn for agent %s", agent_id, exc_info=True)
```

Add to the module docstring: "After a successful forward the gateway counts the turn for the
message's contextId (A-07)."

- [ ] **Step 4: Run the tests**

Run: `cd apps/api && uv run pytest -q` → all pass; `uv run ruff format --check . && uv run ruff check .` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/app/gateway apps/api/tests/test_gateway.py
git commit -m "feat(gateway): count each forwarded turn per A2A session (A-07)"
```

---

### Task 5: Contract docs

**Files:**
- Modify: `docs/api-contract-agents.md`

- [ ] **Step 1: Add an "Audit log and sessions (A-07, FR-28/FR-36) — implemented" section** with:
  the three GET endpoints, their query parameters, the `AuditEvent` and `Session` field lists, the
  cursor note ("opaque; pass `next_cursor` back as `before`"), errors (401/422/503); then a
  "Reporting hits (for B-02, B-05, B-06)" subsection:

```markdown
Report every block, redaction, warning and limit hit through the recorder, never by writing the
tables directly:

    from app.audit.models import AuditEventIn
    from app.audit.recorder import AuditRecorder, get_audit_recorder

    recorder.record_events(agent_id, gateway_key, context_id, [
        AuditEventIn(rule_id=g.id, rule_name=g.name, kind="guardrail", stage="input",
                     action="block", config_version=effective.version, details=reason),
    ])

A `kind="limit"` event with `action="block"` marks the session stopped with `details` as the
reason. `details` is the reason only (≤ 500 chars) — never message text. The gateway already
counts turns and tokens (`record_turn`); B-05 adds cost and fills `Session.limits`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/api-contract-agents.md
git commit -m "docs: audit log and sessions API and how to report hits (A-07)"
```

---

### Task 6: Web types, hooks, formatting and the fake API

**Files:**
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/test/fakeApi.ts`
- Create: `apps/web/src/api/audit.ts`, `apps/web/src/ui/format.ts`, `apps/web/src/pages/ApiUnavailable.tsx`

**Interfaces:**
- Produces (`types.ts`): `AuditAction`, `AuditKind`, `AuditEvent`, `AuditEventPage`, `AuditRule`,
  `SessionLimit`, `AgentSession`, `SessionPage`, `AuditFilters`, `SessionFilters`.
- Produces (`audit.ts`): `useAuditEvents(filters: AuditFilters)`, `useAuditRules()`,
  `useSessions(filters: SessionFilters)`; `isMissingEndpoint(error: unknown): boolean`.
- Produces (`format.ts`): `formatTime(iso: string): string`, `formatRelative(iso: string, now?: number): string`,
  `formatDuration(seconds: number): string`, `formatCost(usd: number): string`, `shortId(id: string): string`.
- Produces (`ApiUnavailable.tsx`): `LoadError({ what, error, onRetry })`.
- Produces (`fakeApi`): `fakeApi.auditEvents: AuditEvent[]`, `fakeApi.sessions: AgentSession[]`,
  `fakeApi.auditSupported: boolean`, `fakeApi.auditPageSize: number`, `fakeApi.auditRequests: URL[]`.

- [ ] **Step 1: Types** — append to `src/api/types.ts`:

```ts
// --- audit log and sessions (A-07, mirror apps/api/app/audit/models.py) ---

export type AuditAction = 'block' | 'redact' | 'warn'
export type AuditKind = 'guardrail' | 'limit'

export interface AuditEvent {
  id: string
  at: string
  agent_id: string
  agent_name: string | null
  context_id: string | null
  rule_id: string
  rule_name: string
  kind: AuditKind
  stage: 'input' | 'output' | null
  action: AuditAction
  config_version: string | null
  details: string
}

export interface AuditEventPage {
  data: AuditEvent[]
  next_cursor: string | null
}

export interface AuditRule {
  rule_id: string
  rule_name: string
  kind: AuditKind
}

export interface SessionLimit {
  name: string
  used: number
  max: number
  unit?: string | null
}

export interface AgentSession {
  agent_id: string
  agent_name: string | null
  context_id: string
  turns: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  started_at: string
  last_at: string
  duration_seconds: number
  status: 'active' | 'stopped'
  stop_reason: string | null
  events: number
  /** Empty until B-05 (limits) exists. */
  limits: SessionLimit[]
}

export interface SessionPage {
  data: AgentSession[]
  next_cursor: string | null
}

export interface AuditFilters {
  agent_id?: string
  rule_id?: string
  action?: AuditAction
  context_id?: string
}

export interface SessionFilters {
  agent_id?: string
  status?: 'active' | 'stopped'
}
```

- [ ] **Step 2: Hooks** — `src/api/audit.ts`:

```ts
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ApiError, getJson } from './client'
import type { AuditEventPage, AuditFilters, AuditRule, SessionFilters, SessionPage } from './types'

function withQuery(path: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) if (value) query.set(key, value)
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

export const auditKeys = {
  events: (filters: AuditFilters) => ['audit-events', filters] as const,
  rules: ['audit-rules'] as const,
  sessions: (filters: SessionFilters) => ['sessions', filters] as const,
}

/** 404/405: this API deployment doesn't have A-07 yet. */
export function isMissingEndpoint(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 405)
}

export function useAuditEvents(filters: AuditFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.events(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      getJson<AuditEventPage>(withQuery('/audit-events', { ...filters, before: pageParam })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}

export function useAuditRules() {
  return useQuery({ queryKey: auditKeys.rules, queryFn: () => getJson<AuditRule[]>('/audit-events/rules') })
}

export function useSessions(filters: SessionFilters) {
  return useInfiniteQuery({
    queryKey: auditKeys.sessions(filters),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getJson<SessionPage>(withQuery('/sessions', { ...filters, before: pageParam })),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
}
```

- [ ] **Step 3: Formatting** — `src/ui/format.ts`:

```ts
// Display helpers for timestamps, durations and money in tables.

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
}

export function formatRelative(iso: string, now: number = Date.now()): string {
  const seconds = Math.round((now - new Date(iso).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`
  return `${Math.floor(seconds / 86400)} d ago`
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
}

export function formatCost(usd: number): string {
  return `$${usd.toFixed(4)}`
}

/** Long ids (contextId) shortened for a table cell; the full value goes in a title. */
export function shortId(id: string): string {
  return id.length > 14 ? `${id.slice(0, 10)}…${id.slice(-3)}` : id
}
```

- [ ] **Step 4: Shared load error** — `src/pages/ApiUnavailable.tsx`:

```tsx
import { isMissingEndpoint } from '../api/audit'
import { buttonSecondary } from '../ui/classes'

const MISSING = "The audit API isn't available on this server yet (A-07)."

/** Load failure for the audit screens: a missing endpoint is explained, anything else can be retried. */
export function LoadError({ what, error, onRetry }: { what: string; error: unknown; onRetry: () => void }) {
  if (isMissingEndpoint(error)) {
    return (
      <p role="alert" className="m-0 rounded-xl bg-warn-bg p-4 text-sm text-warn-fg">
        {MISSING}
      </p>
    )
  }
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
      <span className="text-sm">Couldn't load {what}.</span>
      <button type="button" className={buttonSecondary} onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
```

- [ ] **Step 5: Fake API** — in `src/test/fakeApi.ts` add the type imports (`AgentSession`,
  `AuditEvent`), seeds, state, reset lines and handlers. Seeds (agent ids match `seedAgents()`):

```ts
const T0 = Date.parse('2026-10-04T10:00:00Z')
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString()

function seedAuditEvents(): AuditEvent[] {
  // newest first, like the API
  const base = { agent_name: null, config_version: 'v-3f2a', stage: null } as const
  return [
    { ...base, id: 'ev-5', at: at(9), agent_id: 'agent-support', context_id: 'ctx-stopped', rule_id: 'maxSessionTokens', rule_name: 'Session tokens', kind: 'limit', action: 'block', details: 'Session token cap reached' },
    { ...base, id: 'ev-4', at: at(8), agent_id: 'agent-support', context_id: 'ctx-stopped', rule_id: 'g-pii', rule_name: 'PII', kind: 'guardrail', stage: 'output', action: 'redact', details: 'Email address' },
    { ...base, id: 'ev-3', at: at(6), agent_id: 'agent-contracts', context_id: 'ctx-contracts', rule_id: 'g-pii', rule_name: 'PII', kind: 'guardrail', stage: 'input', action: 'warn', details: 'Phone number' },
    { ...base, id: 'ev-2', at: at(4), agent_id: 'agent-support', context_id: 'ctx-active', rule_id: 'g-inject', rule_name: 'Prompt injection', kind: 'guardrail', stage: 'input', action: 'block', details: 'Matched signature "ignore previous"' },
    { ...base, id: 'ev-1', at: at(2), agent_id: 'agent-support', context_id: 'ctx-active', rule_id: 'g-pii', rule_name: 'PII', kind: 'guardrail', stage: 'output', action: 'redact', details: 'Card number' },
  ]
}

function seedSessions(): AgentSession[] {
  const base = { agent_name: null, cost_usd: 0, limits: [] }
  return [
    { ...base, agent_id: 'agent-support', context_id: 'ctx-stopped', turns: 6, input_tokens: 5200, output_tokens: 4800, started_at: at(0), last_at: at(9), duration_seconds: 540, status: 'stopped', stop_reason: 'Session token cap reached', events: 2,
      limits: [{ name: 'Session tokens', used: 10000, max: 10000, unit: 'tokens' }] },
    { ...base, agent_id: 'agent-contracts', context_id: 'ctx-contracts', turns: 2, input_tokens: 300, output_tokens: 120, started_at: at(5), last_at: at(6), duration_seconds: 60, status: 'active', stop_reason: null, events: 1 },
    { ...base, agent_id: 'agent-support', context_id: 'ctx-active', turns: 3, input_tokens: 90, output_tokens: 75, started_at: at(1), last_at: at(4), duration_seconds: 180, status: 'active', stop_reason: null, events: 2 },
  ]
}
```

State fields (add to the `fakeApi` type, initial object and `resetFakeApi`):
`auditEvents: seedAuditEvents()`, `sessions: seedSessions()`, `auditSupported: true`,
`auditPageSize: 50`, `auditRequests: [] as URL[]`.

Handlers (before the `/agents/:id/gateway-key` handler); cursor = index of the next row as a string:

```ts
  http.get(apiPath('/audit-events'), ({ request }) => {
    if (!fakeApi.auditSupported) return detail(404, 'Not Found')
    const url = new URL(request.url)
    fakeApi.auditRequests.push(url)
    const p = url.searchParams
    const rows = fakeApi.auditEvents.filter(
      (e) =>
        (!p.get('agent_id') || e.agent_id === p.get('agent_id')) &&
        (!p.get('rule_id') || e.rule_id === p.get('rule_id')) &&
        (!p.get('action') || e.action === p.get('action')) &&
        (!p.get('context_id') || e.context_id === p.get('context_id')),
    )
    return HttpResponse.json(page(rows, p))
  }),

  http.get(apiPath('/audit-events/rules'), () => {
    if (!fakeApi.auditSupported) return detail(404, 'Not Found')
    const rules = new Map(fakeApi.auditEvents.map((e) => [e.rule_id, { rule_id: e.rule_id, rule_name: e.rule_name, kind: e.kind }]))
    return HttpResponse.json([...rules.values()])
  }),

  http.get(apiPath('/sessions'), ({ request }) => {
    if (!fakeApi.auditSupported) return detail(404, 'Not Found')
    const p = new URL(request.url).searchParams
    const rows = fakeApi.sessions.filter(
      (s) => (!p.get('agent_id') || s.agent_id === p.get('agent_id')) && (!p.get('status') || s.status === p.get('status')),
    )
    return HttpResponse.json(page(rows, p))
  }),
```

with the helper (module level):

```ts
function page<T>(rows: T[], params: URLSearchParams): { data: T[]; next_cursor: string | null } {
  const start = Number(params.get('before') ?? 0)
  const size = Number(params.get('limit')) || fakeApi.auditPageSize
  const end = start + size
  return { data: rows.slice(start, end), next_cursor: end < rows.length ? String(end) : null }
}
```

- [ ] **Step 6: Check**

Run: `cd apps/web && pnpm build && pnpm lint` → clean (pages come next; nothing imports the hooks yet
except the fake, which is fine).

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/api apps/web/src/ui/format.ts apps/web/src/pages/ApiUnavailable.tsx apps/web/src/test/fakeApi.ts
git commit -m "feat(web): audit and sessions API hooks and test fake (D-06)"
```

---

### Task 7: Audit log page

**Files:**
- Create: `apps/web/src/pages/audit/AuditLogPage.tsx`, `apps/web/src/pages/audit/AuditLogPage.test.tsx`
- Modify: `apps/web/src/app/AppRoutes.tsx` (`'/audit': <AuditLogPage />`)

**Interfaces:**
- Consumes: `useAuditEvents`, `useAuditRules`, `useAgents`, `LoadError`, `formatTime`, `shortId`,
  `badgeClass`, `buttonSecondary`, `inputClass`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const table = () => screen.findByRole('region', { name: 'Audit events table' })
const rows = () => within(screen.getByRole('region', { name: 'Audit events table' })).getAllByRole('row').slice(1)
const location = () => screen.getByTestId('location').textContent

describe('Audit log', () => {
  it('lists events newest first with rule, result and details', async () => {
    renderApp('/audit')
    await table()
    expect(rows()).toHaveLength(5)
    const first = rows()[0]
    expect(within(first).getByText('Session tokens')).toBeInTheDocument()
    expect(within(first).getByText('Limit')).toBeInTheDocument()
    expect(within(first).getByText('Block')).toBeInTheDocument()
    expect(within(first).getByText('Support Assistant')).toBeInTheDocument()
    expect(within(first).getByText('Session token cap reached')).toBeInTheDocument()
  })

  it('combines filters and keeps them in the URL', async () => {
    const user = userEvent.setup()
    renderApp('/audit')
    await table()
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-support')
    await screen.findByRole('option', { name: 'PII' }) // rules load separately
    await user.selectOptions(screen.getByLabelText('Rule'), 'g-pii')
    await user.selectOptions(screen.getByLabelText('Result'), 'redact')
    await screen.findByText('Card number')
    expect(rows()).toHaveLength(2)
    expect(location()).toBe('/audit?agent_id=agent-support&rule_id=g-pii&action=redact')
    const last = fakeApi.auditRequests.at(-1)
    expect(last?.searchParams.get('rule_id')).toBe('g-pii')

    await user.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(location()).toBe('/audit')
    expect(await screen.findByText('Phone number')).toBeInTheDocument()
  })

  it('shows a session filter as a removable chip', async () => {
    const user = userEvent.setup()
    renderApp('/audit?context_id=ctx-active')
    await screen.findByText('Card number')
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Remove session filter ctx-active' }))
    expect(location()).toBe('/audit')
  })

  it('loads more pages', async () => {
    fakeApi.auditPageSize = 2
    const user = userEvent.setup()
    renderApp('/audit')
    await table()
    expect(rows()).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Phone number')
    expect(rows()).toHaveLength(4)
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    await screen.findByText('Card number')
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument()
  })

  it('has empty states with and without filters', async () => {
    fakeApi.auditEvents = []
    renderApp('/audit')
    expect(await screen.findByText('No audit events yet. Blocks, redactions, warnings and limit hits appear here.')).toBeInTheDocument()
  })

  it('says when no event matches', async () => {
    renderApp('/audit?context_id=nope')
    expect(await screen.findByText('No events match these filters.')).toBeInTheDocument()
  })

  it('explains a missing audit API', async () => {
    fakeApi.auditSupported = false
    renderApp('/audit')
    expect(await screen.findByText("The audit API isn't available on this server yet (A-07).")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run src/pages/audit`
Expected: FAIL (placeholder page, no table).

- [ ] **Step 3: Implement** `AuditLogPage.tsx`:

```tsx
import { useSearchParams } from 'react-router'
import { useAgents } from '../../api/agents'
import { useAuditEvents, useAuditRules } from '../../api/audit'
import type { AuditAction, AuditEvent, AuditFilters } from '../../api/types'
import { badgeClass, buttonSecondary, inputClass } from '../../ui/classes'
import { formatTime, shortId } from '../../ui/format'
import { LoadError } from '../ApiUnavailable'

const ACTIONS: Record<AuditAction, { label: string; className: string }> = {
  block: { label: 'Block', className: 'bg-[#FBE7E2] text-danger' },
  redact: { label: 'Redact', className: 'bg-warn-bg text-warn-fg' },
  warn: { label: 'Warn', className: 'bg-warn-bg text-warn-fg' },
}
const FILTER_KEYS = ['agent_id', 'rule_id', 'action', 'context_id'] as const
const HEADERS = ['Time', 'Agent', 'Session', 'Rule', 'Stage', 'Result', 'Config', 'Details']
const cell = 'px-4 py-3 align-top'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'

function readFilters(params: URLSearchParams): AuditFilters {
  const action = params.get('action')
  return {
    agent_id: params.get('agent_id') || undefined,
    rule_id: params.get('rule_id') || undefined,
    action: action === 'block' || action === 'redact' || action === 'warn' ? action : undefined,
    context_id: params.get('context_id') || undefined,
  }
}

export function AuditLogPage() {
  const [params, setParams] = useSearchParams()
  const filters = readFilters(params)
  const events = useAuditEvents(filters)
  const rules = useAuditRules()
  const agents = useAgents()
  const filtered = FILTER_KEYS.some((key) => filters[key])

  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  const agentName = (event: AuditEvent) =>
    event.agent_name ?? agents.data?.find((a) => a.id === event.agent_id)?.name ?? event.agent_id
  const list = events.data?.pages.flatMap((page) => page.data) ?? []
  const guardrailRules = rules.data?.filter((r) => r.kind === 'guardrail') ?? []
  const limitRules = rules.data?.filter((r) => r.kind === 'limit') ?? []

  let content
  if (events.isError) {
    content = <LoadError what="audit events" error={events.error} onRetry={() => void events.refetch()} />
  } else if (events.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading audit events…</p>
  } else if (list.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        {filtered ? 'No events match these filters.' : 'No audit events yet. Blocks, redactions, warnings and limit hits appear here.'}
      </div>
    )
  } else {
    content = (
      <>
        <div role="region" aria-label="Audit events table" tabIndex={0} className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
                {HEADERS.map((h) => (
                  <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {list.map((event) => (
                <tr key={event.id} className="border-b border-line last:border-b-0">
                  <td className={`${cell} whitespace-nowrap text-muted`}>{formatTime(event.at)}</td>
                  <td className={cell}>{agentName(event)}</td>
                  <td className={`${cell} font-mono text-xs`} title={event.context_id ?? undefined}>
                    {event.context_id ? shortId(event.context_id) : '—'}
                  </td>
                  <td className={cell}>
                    <span className="flex flex-col gap-0.5">
                      <span className="font-semibold">{event.rule_name}</span>
                      <span className="text-xs text-muted">{event.kind === 'limit' ? 'Limit' : 'Guardrail'}</span>
                    </span>
                  </td>
                  <td className={`${cell} text-muted`}>{event.stage ?? '—'}</td>
                  <td className={cell}>
                    <span className={`${badgeClass} ${ACTIONS[event.action].className}`}>{ACTIONS[event.action].label}</span>
                  </td>
                  <td className={`${cell} font-mono text-xs text-muted`}>{event.config_version ?? '—'}</td>
                  <td className={`${cell} max-w-80`}>{event.details || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.hasNextPage && (
          <button type="button" className={`${buttonSecondary} self-start`} disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>
            {events.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Audit log</h1>
          <p className="m-0 text-[15px] text-muted">Every block, redaction, warning and limit hit, newest first.</p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => void events.refetch()}>Refresh</button>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="audit-agent" className={labelClass}>Agent</label>
          <select id="audit-agent" value={filters.agent_id ?? ''} onChange={(e) => setFilter('agent_id', e.target.value)} className={inputClass}>
            <option value="">All agents</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="audit-rule" className={labelClass}>Rule</label>
          <select id="audit-rule" value={filters.rule_id ?? ''} onChange={(e) => setFilter('rule_id', e.target.value)} className={inputClass}>
            <option value="">All rules</option>
            {guardrailRules.length > 0 && (
              <optgroup label="Guardrails">
                {guardrailRules.map((r) => <option key={r.rule_id} value={r.rule_id}>{r.rule_name}</option>)}
              </optgroup>
            )}
            {limitRules.length > 0 && (
              <optgroup label="Limits">
                {limitRules.map((r) => <option key={r.rule_id} value={r.rule_id}>{r.rule_name}</option>)}
              </optgroup>
            )}
          </select>
        </div>
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="audit-action" className={labelClass}>Result</label>
          <select id="audit-action" value={filters.action ?? ''} onChange={(e) => setFilter('action', e.target.value)} className={inputClass}>
            <option value="">All results</option>
            <option value="block">Block</option>
            <option value="redact">Redact</option>
            <option value="warn">Warn</option>
          </select>
        </div>
        {filters.context_id && (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-canvas px-3 text-sm">
            Session <code className="text-xs">{shortId(filters.context_id)}</code>
            <button type="button" aria-label={`Remove session filter ${filters.context_id}`} onClick={() => setFilter('context_id', '')} className="cursor-pointer border-0 bg-transparent text-muted">
              ×
            </button>
          </span>
        )}
        {filtered && (
          <button type="button" className={buttonSecondary} onClick={() => setParams(new URLSearchParams())}>Clear filters</button>
        )}
      </div>

      {content}
    </section>
  )
}
```

Route: in `AppRoutes.tsx` import `AuditLogPage` and add `'/audit': <AuditLogPage />` to `PAGES`.

- [ ] **Step 4: Run the tests**

Run: `cd apps/web && pnpm exec vitest run src/pages/audit src/app` → pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/audit apps/web/src/app/AppRoutes.tsx
git commit -m "feat(web): audit log with combined filters in the URL and paging (D-06)"
```

---

### Task 8: Sessions page

**Files:**
- Create: `apps/web/src/pages/sessions/SessionsPage.tsx`, `apps/web/src/pages/sessions/SessionsPage.test.tsx`
- Modify: `apps/web/src/app/AppRoutes.tsx` (`'/sessions': <SessionsPage />`)

**Interfaces:**
- Consumes: `useSessions`, `useAgents`, `LoadError`, format helpers, `pillClass`, `buttonSecondary`, `inputClass`.

- [ ] **Step 1: Write the failing tests**

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const table = () => screen.findByRole('region', { name: 'Sessions table' })
const row = (contextId: string) => screen.getByRole('row', { name: new RegExp(contextId) })

describe('Sessions', () => {
  it('shows each session with counters and status', async () => {
    renderApp('/sessions')
    await table()
    const active = row('ctx-active')
    expect(within(active).getByRole('link', { name: 'Support Assistant' })).toHaveAttribute('href', '/agents/agent-support')
    expect(within(active).getByText('3')).toBeInTheDocument()
    expect(within(active).getByText('90 / 75')).toBeInTheDocument()
    expect(within(active).getByText('3m 0s')).toBeInTheDocument()
    expect(within(active).getByText('Active')).toBeInTheDocument()
  })

  it('shows a session that hit a limit as stopped, with the reason and its meters', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    const stopped = row('ctx-stopped')
    expect(within(stopped).getByText('Stopped')).toBeInTheDocument()
    expect(within(stopped).getByText('Session token cap reached')).toBeInTheDocument()
    await user.click(within(stopped).getByRole('button', { name: 'Show limits for ctx-stopped' }))
    expect(screen.getByRole('progressbar', { name: 'Session tokens' })).toHaveAttribute('value', '10000')
    expect(screen.getByText('Session tokens: 10000 / 10000 tokens')).toBeInTheDocument()
    expect(within(row('ctx-active')).queryByRole('button', { name: /Show limits/ })).not.toBeInTheDocument()
  })

  it('filters by agent and status', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.selectOptions(screen.getByLabelText('Status'), 'stopped')
    await screen.findByText('Session token cap reached')
    expect(screen.queryByRole('row', { name: /ctx-active/ })).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Status'), '')
    await user.selectOptions(screen.getByLabelText('Agent'), 'agent-contracts')
    await screen.findByRole('row', { name: /ctx-contracts/ })
    expect(screen.queryByRole('row', { name: /ctx-stopped/ })).not.toBeInTheDocument()
  })

  it('opens the audit log filtered to a session', async () => {
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.click(within(row('ctx-active')).getByRole('link', { name: '2 events' }))
    expect(screen.getByTestId('location').textContent).toBe('/audit?context_id=ctx-active')
    expect(await screen.findByText('Card number')).toBeInTheDocument()
  })

  it('loads more sessions', async () => {
    fakeApi.auditPageSize = 2
    const user = userEvent.setup()
    renderApp('/sessions')
    await table()
    await user.click(screen.getByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('row', { name: /ctx-active/ })).toBeInTheDocument()
  })

  it('has an empty state', async () => {
    fakeApi.sessions = []
    renderApp('/sessions')
    expect(await screen.findByText("No sessions yet. Calls through an agent's guarded URL show up here.")).toBeInTheDocument()
  })

  it('explains a missing audit API', async () => {
    fakeApi.auditSupported = false
    renderApp('/sessions')
    expect(await screen.findByText("The audit API isn't available on this server yet (A-07).")).toBeInTheDocument()
  })

  it('is not available to testers', () => {
    renderApp('/sessions', 'tester')
    expect(screen.getByTestId('location').textContent).toBe('/test')
  })
})
```

- [ ] **Step 2: Run to see them fail**

Run: `cd apps/web && pnpm exec vitest run src/pages/sessions` → FAIL.

- [ ] **Step 3: Implement** `SessionsPage.tsx`:

```tsx
import { Fragment, useState } from 'react'
import { Link } from 'react-router'
import { useAgents } from '../../api/agents'
import { useSessions } from '../../api/audit'
import type { AgentSession, SessionFilters } from '../../api/types'
import { buttonSecondary, inputClass, pillClass } from '../../ui/classes'
import { formatCost, formatDuration, formatRelative, formatTime, shortId } from '../../ui/format'
import { LoadError } from '../ApiUnavailable'

const HEADERS = ['Agent', 'Session', 'Started', 'Turns', 'Tokens (in / out)', 'Cost', 'Duration', 'Status', 'Events']
const cell = 'px-4 py-3 align-top'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'
const key = (s: AgentSession) => `${s.agent_id}/${s.context_id}`

export function SessionsPage() {
  const [filters, setFilters] = useState<SessionFilters>({})
  const [open, setOpen] = useState<string | null>(null)
  const sessions = useSessions(filters)
  const agents = useAgents()
  const list = sessions.data?.pages.flatMap((page) => page.data) ?? []
  const agentName = (s: AgentSession) => s.agent_name ?? agents.data?.find((a) => a.id === s.agent_id)?.name ?? s.agent_id

  let content
  if (sessions.isError) {
    content = <LoadError what="sessions" error={sessions.error} onRetry={() => void sessions.refetch()} />
  } else if (sessions.isPending) {
    content = <p className="m-0 text-sm text-muted">Loading sessions…</p>
  } else if (list.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        {filters.agent_id || filters.status ? 'No sessions match these filters.' : "No sessions yet. Calls through an agent's guarded URL show up here."}{' '}
        <Link to="/agents" className="font-semibold">Go to Agents</Link>
      </div>
    )
  } else {
    content = (
      <>
        <div role="region" aria-label="Sessions table" tabIndex={0} className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[960px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
                {HEADERS.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const expanded = open === key(s)
                return (
                  <Fragment key={key(s)}>
                    <tr className="border-b border-line last:border-b-0">
                      <td className={cell}>
                        <Link to={`/agents/${s.agent_id}`} className="font-semibold">{agentName(s)}</Link>
                      </td>
                      <td className={`${cell} font-mono text-xs`} title={s.context_id}>{shortId(s.context_id)}</td>
                      <td className={`${cell} whitespace-nowrap text-muted`} title={formatTime(s.started_at)}>{formatRelative(s.started_at)}</td>
                      <td className={cell}>{s.turns}</td>
                      <td className={`${cell} whitespace-nowrap`}>{s.input_tokens} / {s.output_tokens}</td>
                      <td className={cell}>{formatCost(s.cost_usd)}</td>
                      <td className={cell}>{formatDuration(s.duration_seconds)}</td>
                      <td className={cell}>
                        <span className="flex flex-col items-start gap-1">
                          {s.status === 'stopped' ? (
                            <span className={`${pillClass} bg-[#FBE7E2] text-danger`}>Stopped</span>
                          ) : (
                            <span className={`${pillClass} bg-teal-soft text-teal-dark`}>Active</span>
                          )}
                          {s.stop_reason && <span className="text-xs text-muted">{s.stop_reason}</span>}
                          {s.limits.length > 0 && (
                            <button
                              type="button"
                              aria-expanded={expanded}
                              aria-label={`${expanded ? 'Hide' : 'Show'} limits for ${s.context_id}`}
                              onClick={() => setOpen(expanded ? null : key(s))}
                              className="cursor-pointer border-0 bg-transparent p-0 text-xs font-semibold text-teal-dark"
                            >
                              {expanded ? 'Hide limits' : 'Show limits'}
                            </button>
                          )}
                        </span>
                      </td>
                      <td className={cell}>
                        {s.events > 0 ? (
                          <Link to={`/audit?context_id=${encodeURIComponent(s.context_id)}`}>
                            {s.events} {s.events === 1 ? 'event' : 'events'}
                          </Link>
                        ) : (
                          <span className="text-muted">0</span>
                        )}
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="border-b border-line bg-canvas">
                        <td colSpan={HEADERS.length} className="px-4 py-3">
                          <ul className="m-0 flex max-w-md list-none flex-col gap-2 p-0">
                            {s.limits.map((l) => (
                              <li key={l.name} className="flex flex-col gap-1 text-sm">
                                <span>{l.name}: {l.used} / {l.max}{l.unit ? ` ${l.unit}` : ''}</span>
                                <progress value={Math.min(l.used, l.max)} max={l.max} aria-label={l.name} className="h-2 w-full" />
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
        {sessions.hasNextPage && (
          <button type="button" className={`${buttonSecondary} self-start`} disabled={sessions.isFetchingNextPage} onClick={() => void sessions.fetchNextPage()}>
            {sessions.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        )}
      </>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Sessions</h1>
          <p className="m-0 text-[15px] text-muted">
            One row per A2A conversation (contextId) through the guarded URL. Counters only, no message content.
          </p>
        </div>
        <button type="button" className={buttonSecondary} onClick={() => void sessions.refetch()}>Refresh</button>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-col gap-1.5">
          <label htmlFor="sessions-agent" className={labelClass}>Agent</label>
          <select id="sessions-agent" value={filters.agent_id ?? ''} onChange={(e) => setFilters((f) => ({ ...f, agent_id: e.target.value || undefined }))} className={inputClass}>
            <option value="">All agents</option>
            {agents.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="flex min-w-40 flex-col gap-1.5">
          <label htmlFor="sessions-status" className={labelClass}>Status</label>
          <select
            id="sessions-status"
            value={filters.status ?? ''}
            onChange={(e) => {
              const value = e.target.value
              setFilters((f) => ({ ...f, status: value === 'active' || value === 'stopped' ? value : undefined }))
            }}
            className={inputClass}
          >
            <option value="">All</option>
            <option value="active">Active</option>
            <option value="stopped">Stopped</option>
          </select>
        </div>
      </div>
      {content}
    </section>
  )
}
```

Route: import `SessionsPage` and add `'/sessions': <SessionsPage />` to `PAGES`.

- [ ] **Step 4: Run all web checks**

Run: `cd apps/web && pnpm exec vitest run && pnpm lint && pnpm build`
Expected: everything passes (AppRoutes/Layout tests that land on `/sessions` now hit the fake
`/sessions` handler — that's why Task 6 added it).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/sessions apps/web/src/app/AppRoutes.tsx
git commit -m "feat(web): sessions view with stop reasons, limit meters and audit links (D-06)"
```

---

### Task 9: Full verification

- [ ] `cd apps/api && uv run pytest -q && uv run ruff format --check . && uv run ruff check .`
- [ ] `make lint && make test` from the repo root (root workspace; untouched but required).
- [ ] `cd apps/web && pnpm lint && pnpm build && pnpm exec vitest run`
- [ ] PGlite run from Task 1 again against the final migrations folder.
- [ ] Fix anything found, commit as `fix:` with what changed.
