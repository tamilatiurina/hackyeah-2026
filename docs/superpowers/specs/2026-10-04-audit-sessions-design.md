# Audit log and sessions (A-07 + D-06) — design

Issues: #39 (A-07, API) and #59 (D-06, panel). Requirements: FR-28 (audit log, Must), FR-36 (session
view, Should). Approved by the user on 2026-10-04, section by section, including the tests below.

## Goal

Security teams and developers see, per agent, every guardrail and limit hit (block, redact, warn)
and every A2A session's counters. The panel screens work against a real API, and the gateway
already records session counters, so the Sessions screen shows real traffic today. Audit events
appear once B-02 (guardrail pipeline), B-05 (limits) and B-06 (test chat) report through the
recorder defined here.

## Scope

In scope: the database tables and functions, the write-side recorder, the read API, the gateway
recording one turn per forwarded call, the Sessions and Audit log screens, contract docs and tests.

Out of scope: running guardrails or limits (B-02, B-05), spend overview (S-03), CSV export, live
auto-refresh, admin-wide visibility (needs real roles, A-08).

## Data (migration `<timestamp>_audit_and_sessions.sql`)

No message content is ever stored: sessions hold counters, audit events hold rule ids and a short
reason.

`agent_sessions`

| column | type | notes |
| --- | --- | --- |
| `agent_id` | uuid → `agents(id)` on delete cascade | |
| `context_id` | text, 1–200 chars | A2A `contextId` |
| `turns` | integer ≥ 0 | |
| `input_tokens`, `output_tokens` | bigint ≥ 0 | from the reply's `metadata.usage`, else 0 |
| `cost_usd` | numeric(12,6) ≥ 0 | |
| `started_at`, `last_at` | timestamptz | duration = `last_at − started_at` |
| `stopped_at`, `stop_reason` | timestamptz, text, nullable | set by a limit block |

Primary key `(agent_id, context_id)`; index on `last_at desc`.

`audit_events`

| column | type | notes |
| --- | --- | --- |
| `id` | uuid default `gen_random_uuid()` | |
| `at` | timestamptz default `now()` | |
| `agent_id` | uuid → `agents(id)` on delete cascade | |
| `context_id` | text, nullable | |
| `rule_id`, `rule_name` | text | guardrail id or limit name (e.g. `maxSessionTokens`) |
| `kind` | `guardrail` \| `limit` | check constraint |
| `stage` | `input` \| `output` \| null | |
| `action` | `block` \| `redact` \| `warn` | check constraint |
| `config_version` | text, nullable | effective-guardrails `version` or agent config version |
| `details` | text ≤ 500 chars | the reason, never message text |

Indexes: `(at desc, id desc)`, `(agent_id, at desc)`, `(context_id)`.

RLS on both: `authenticated` may `select` rows whose agent they own
(`exists (select 1 from agents a where a.id = agent_id and a.owner_id = auth.uid())`). No insert,
update or delete for `authenticated` or `anon`; `service_role` all.

Gateway functions (`security definer`, `set search_path = ''`, executable by `anon` and
`authenticated`), each first checking `agents.gateway_key_hash = p_key_hash` like
`gateway_resolve_agent`; a wrong key does nothing and returns no rows:

- `gateway_record_turn(p_agent_id uuid, p_key_hash text, p_context_id text, p_input_tokens bigint,
  p_output_tokens bigint, p_cost_usd numeric)` → the session row after the update (upsert: insert
  with `turns = 1` or add to the counters and set `last_at = now()`).
- `gateway_record_events(p_agent_id uuid, p_key_hash text, p_context_id text, p_events jsonb)` →
  number inserted. `p_events` is an array of `{rule_id, rule_name, kind, stage, action,
  config_version, details}`. A `kind = 'limit'` event with `action = 'block'` sets the session's
  `stopped_at = now()` and `stop_reason = details` (creating the session row if needed).

## API (`apps/api/app/audit/`)

`models.py`: `AuditEventIn` (what reporters send), `AuditEvent`, `AuditEventPage`, `AuditRule`,
`Session`, `SessionLimit`, `SessionPage`, `SessionCounters`.

`recorder.py` — write side, used by the gateway and later B-02/B-05/B-06:

```python
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
```

In-memory implementation (shared module-level store, used without Supabase and in tests) and a
Supabase one calling the two functions with the anon client. Recording failures are logged and
swallowed: an audit outage must not break a call that already succeeded.

`repository.py` — read side, following `app/mcp/repository.py`: `AuditRepository` Protocol with
`events(filters) → AuditEventPage`, `rules() → list[AuditRule]`, `sessions(filters) → SessionPage`;
in-memory and Supabase implementations; the dependency needs a Bearer token when Supabase is
configured (401 otherwise) and uses the user's client so RLS scopes the rows. The in-memory store
has no owners, so it returns everything (local runs and tests only).

Routes (`app/api/routes/audit.py`), all under `/api/v1`:

- `GET /audit-events?agent_id&rule_id&action&kind&context_id&limit=50&before` →
  `{ data: AuditEvent[], next_cursor: string | null }`. Filters combine with AND. Newest first by
  `(at, id)`; `before` is an opaque cursor (base64url of `at|id`), `limit` 1–200.
  `AuditEvent = { id, at, agent_id, agent_name, context_id, rule_id, rule_name, kind, stage, action,
  config_version, details }`.
- `GET /audit-events/rules` → distinct `{ rule_id, rule_name, kind }[]` from the caller's events,
  sorted by kind then name.
- `GET /sessions?agent_id&status=active|stopped&limit=50&before` →
  `{ data: Session[], next_cursor }`, ordered by `last_at` desc (cursor `last_at|agent_id|context_id`).
  `Session = { agent_id, agent_name, context_id, turns, input_tokens, output_tokens, cost_usd,
  started_at, last_at, duration_seconds, status, stop_reason, events, limits }`; `events` = number
  of audit events in the session; `limits: { name, used, max, unit }[]` is always `[]` until B-05.

Errors: 401 no session, 422 bad filter or cursor, 503 storage unavailable.

Gateway: after a successful forward (a result, not a JSON-RPC error), `forward_to_agent` calls
`record_turn` with the request's `params.message.contextId` (a call without one is not recorded)
and tokens from the reply's `metadata.usage` (`inputTokens`/`outputTokens`, per the A2A profile)
when present, else 0; cost 0 until B-05 prices it.

## Panel (`apps/web`)

`src/api/audit.ts`: types mirroring the API; `useAuditEvents(filters)` and `useSessions(filters)`
(`useInfiniteQuery` on `next_cursor`), `useAuditRules()`. The agent filter uses `useAgents()`.

**Sessions** (`/sessions`, `src/pages/sessions/`)

- Header "Sessions", line "One row per A2A conversation (contextId) through the guarded URL.
  Counters only, no message content." and a **Refresh** button.
- Filters: Agent (select, "All agents"), Status (All / Active / Stopped).
- Table: Agent (link to `/agents/:id`), Session (`contextId`, monospace, truncated, full value in
  `title`), Started (relative, absolute in `title`), Turns, Tokens (`in / out`), Cost (`$0.0000`),
  Duration (`2m 14s`), Status, Events.
- Status: "Active" pill, or a red "Stopped" pill with the stop reason under it.
- Limits: when `limits` is non-empty, a "Show limits" toggle on the row reveals labelled meters
  (`used / max unit`).
- Events: when > 0, a link to `/audit?context_id=…` ("3 events").
- "Load more" while `next_cursor` is set.
- Empty: "No sessions yet. Calls through an agent's guarded URL show up here." + link to Agents.

**Audit log** (`/audit`, `src/pages/audit/`)

- Header "Audit log", line "Every block, redaction, warning and limit hit, newest first." and
  **Refresh**.
- Filters: Agent, Rule (from `/audit-events/rules`, `<optgroup>` Guardrails / Limits), Result
  (Block / Redact / Warn). They combine and live in the URL query (`agent_id`, `rule_id`,
  `action`, `context_id`); a `context_id` shows as a removable "Session ctx-…" chip; **Clear
  filters** resets all.
- Table: Time, Agent, Session, Rule (name + "Guardrail"/"Limit" tag), Stage, Result (badge: Block
  red, Redact and Warn amber), Config version, Details.
- "Load more" while `next_cursor` is set.
- Empty: with filters "No events match these filters."; without "No audit events yet. Blocks,
  redactions, warnings and limit hits appear here."

Both screens: 404/405 → "The audit API isn't available on this server yet (A-07)."; other errors
→ "Couldn't load sessions/audit events." with Retry. Testers can't open either (D-01 routing).

## Tests

API (pytest, in-memory):

1. Event filters combine (agent + rule + action), newest first, cursor paging without overlap,
   invalid cursor → 422, `limit` bounds.
2. `rules()` returns distinct rules grouped by kind.
3. `record_turn` creates then increments a session; tokens and `last_at` add up.
4. A limit `block` event stops the session with its reason; a `warn` does not.
5. Session filters (`agent_id`, `status`) and `events` count.
6. The gateway records a turn with `metadata.usage` tokens after a forward; a JSON-RPC error or a
   missing `contextId` records nothing; a recorder failure doesn't change the response.
7. Without a token and with Supabase configured → 401.

Migration: applied in order in PGlite; a non-owner sees no rows; the functions ignore a wrong key.

Panel (Vitest, fake handlers with the same filters and cursor):

1. Audit filters combine and sync with the URL; Clear filters; the session chip.
2. Load more appends the next page.
3. A stopped session shows "Stopped" and its reason; limit meters when `limits` is set.
4. Sessions → "N events" opens the audit log filtered to that session.
5. Empty states, the 404 message and Retry.
6. A tester sees neither screen.

Done when `cd apps/api && uv run pytest -q`, `uv run ruff check` / `ruff format --check` on the
API, and `cd apps/web && pnpm lint && pnpm build && vitest` pass.
