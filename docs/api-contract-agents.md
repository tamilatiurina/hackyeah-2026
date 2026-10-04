# Agents API — what the web app expects

> **A2A:** agents speak A2A 1.0 ([agent-contract-a2a.md](agent-contract-a2a.md)). Registration reads the agent's Agent Card from `<base_url>/.well-known/agent-card.json`; `upstream_url` is the card's JSON-RPC endpoint and `agent_card` holds the card snapshot.

All under `/api/v1`, Bearer token required, errors as FastAPI `{"detail": ...}`.

## FR-05 / FR-06: attaching guardrails — implemented (#90)

The agent page uses the bindings API as built in `apps/api/app/api/routes/bindings.py`:

| Call | Used for |
|---|---|
| `GET /bindings?scope_type=agent&scope_id={agentId}` | the agent's attached guardrails, ordered by `order_index` |
| `POST /bindings` `{scope_type: "agent", scope_id, guardrail_id, order_index, enabled: true}` | attach (appended after the highest `order_index`) |
| `PATCH /bindings/{id}` `{order_index}` / `{enabled}` | reorder (each binding gets its position; unchanged ones aren't sent) / pause and resume |
| `DELETE /bindings/{id}` | detach |
| `GET /effective-guardrails?agent_id={agentId}` | "Runs in this order": input and output lists with each guardrail's source |

Guardrails with `is_mandatory: true` are shown as "Always applied" and never offered for attaching.
Role and user scopes exist in the API; the agent page only manages the agent scope.

## FR-02: edit and delete an agent — implemented

```ts
interface AgentUpdate {              // PATCH body; every field optional
  name?: string
  description?: string
  base_url?: string                  // re-fetches and re-validates the Agent Card
  auth_header?: { name: string; value: string } | null  // object = replace, null = remove, omitted = keep
}
```

| Call | Success | Errors |
|---|---|---|
| `GET /agents/{id}` | 200 `Agent` (includes `config_version`) | 404 "Agent not found"; 422 malformed id |
| `PATCH /agents/{id}` | 200 `Agent`; `config_version` + 1 only when something actually changed | 404 (also for another owner's agent); 409 when the agent was edited meanwhile (the write is guarded on the version read); 409 "An agent with this name already exists"; 422 validation; 502 when a changed `base_url` has no readable A2A 1.0 Agent Card (the detail says why) |
| `DELETE /agents/{id}` (also removes the agent's bindings) | 204 | 404 |

Only the owner can edit or delete an agent (row level security); anyone else gets 404. Admin override of other
people's agents is not built yet. The version is a counter only; there is no history table (FR-09 would need one).

## B-06: test chat — proposed

### `POST /api/v1/agents/{id}/test-chat`

Request: a JSON-RPC 2.0 `SendMessage`, exactly as a client would send to the guarded URL.

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "…",
      "contextId": "ctx-…",
      "role": "ROLE_USER",
      "parts": [{ "text": "#pii" }]
    }
  }
}
```

Response: the guarded pipeline's JSON-RPC response: `result.message` (passed, redacted or warned)
or `result.task` (a `TASK_STATE_REJECTED` refusal when blocked, or a finished task), or a JSON-RPC
`error` passed through from the agent. Hub data lives in `metadata.guardrailHub` on the message or
task:

```ts
interface GuardrailHubMetadata {
  blocked?: boolean
  stage?: 'input' | 'output'          // where a block happened
  trace?: TraceEntry[]
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  limits?: { name: string; used: number; max: number; unit?: string }[]
  scores?: { name: string; score: number }[]   // evaluators (S-01), optional
}

interface TraceEntry {               // one guardrail run (T-04 check result + who ran it)
  guardrailId: string
  guardrailName: string
  engine: 'regex' | 'llm_judge' | 'library' | 'moderation'
  stage: 'input' | 'output'
  verdict: 'pass' | 'block' | 'redact' | 'warn'
  reason: string
  latencyMs: number
  simulated?: boolean
}
```

HTTP errors: 401 (session), 404 (unknown agent), 405/404 when the endpoint doesn't exist yet.

## FR-12: flag a reply — proposed

### `POST /api/v1/agents/{id}/flags`

Body `{ contextId, messageId, comment }` → 201. The owning developer sees flags later (not in this
slice).

The web app treats a 404/405 from these endpoints as "not implemented yet". The A2A shapes follow
`docs/agent-contract-a2a.md`.

## A-07: audit log and sessions (FR-28, FR-36) — implemented

All need the signed-in user's Bearer token (401 without one when Supabase is configured). Rows are
limited by RLS to the caller's own agents. Errors: 401, 422 (bad filter value or cursor), 503
(storage unavailable). Paging is opaque: pass `next_cursor` back as `before`.

### `GET /api/v1/audit-events`

Query (all optional, combined with AND): `agent_id`, `rule_id`, `action` (`block` | `redact` |
`warn`), `kind` (`guardrail` | `limit`), `context_id`, `limit` (1–200, default 50), `before`.
Newest first.

```json
{
  "data": [
    {
      "id": "…", "at": "2026-10-04T10:09:00Z", "agent_id": "…", "agent_name": "Support Assistant",
      "context_id": "ctx-…", "rule_id": "maxSessionTokens", "rule_name": "Session tokens",
      "kind": "limit", "stage": null, "action": "block", "config_version": "…",
      "details": "Session token cap reached"
    }
  ],
  "next_cursor": "…"
}
```

### `GET /api/v1/audit-events/rules`

The distinct `{ rule_id, rule_name, kind }` seen in the caller's events, guardrails first, then
limits, each by name. Feeds the Rule filter.

### `GET /api/v1/sessions`

Query: `agent_id`, `status` (`active` | `stopped`), `limit`, `before`. Most recent activity first.
`Session = { agent_id, agent_name, context_id, turns, input_tokens, output_tokens, cost_usd,
started_at, last_at, duration_seconds, status, stop_reason, events, limits }`. `events` counts the
session's audit events; `limits` (`{ name, used, max, unit }`) stays `[]` until B-05.

No message content is stored: sessions hold counters, events hold the rule and a short reason.

### Reporting hits (B-02, B-05, B-06)

The gateway already counts every forwarded turn and its tokens (`metadata.usage`) per `contextId`,
and reports every guardrail block, redaction and warning (passes are not logged; simulated
verdicts are labelled "Simulated:"). Both the guarded URL and the panel's test chat do this through
`app.gateway.service`.
Report every block, redaction, warning and limit hit through the recorder, never by writing the
tables directly:

```python
from app.audit.models import AuditEventIn
from app.audit.recorder import AuditRecorder, get_audit_recorder  # FastAPI dependency

recorder.record_events(
    agent_id,
    gateway_key,
    context_id,
    [
        AuditEventIn(
            rule_id=g.id,
            rule_name=g.name,
            kind="guardrail",
            stage="input",
            action="block",
            config_version=effective.version,
            details=reason,
        ),
    ],
)
```

A `kind="limit"` event with `action="block"` marks the session stopped, with `details` as the
reason. `details` is the reason only (≤ 500 chars), never message text. With Supabase the recorder
calls the `gateway_record_turn` / `gateway_record_events` functions, which check the gateway key
hash. B-05 adds cost and fills `Session.limits`.

## FR-16 / FR-17: MCP servers and per-agent access — implemented

Signed-in Bearer token required (401 without one when Supabase is configured).

- `PATCH /api/v1/mcp-servers/{id}`: any of `name`, `url`, `auth`, `allowed_tools`. `auth` replaces
  the whole auth, secret included; omit it to keep the current one. A tool removed from a server is
  removed from every agent that had it, and an agent left with no tools loses the server.
  404 unknown, 409 duplicate name, 422 invalid or repeated tool names.
- `McpServer.agents`: how many of the caller's agents may use the server.
- `GET /api/v1/agents/{agent_id}/mcp-servers` →
  `[{ server_id, name, url, available_tools, allowed_tools }]` (`available_tools` = everything the
  server offers; `allowed_tools` = what this agent may call).
- `PUT /api/v1/agents/{agent_id}/mcp-servers/{server_id}` with `{ "allowed_tools": [...] }`: grant
  the server with exactly these tools (attach, or replace the selection). 422 when a tool isn't
  offered by the server, the list is empty or repeats a tool; 404 for an unknown server or an agent
  the caller doesn't own.
- `DELETE /api/v1/agents/{agent_id}/mcp-servers/{server_id}` → 204; 404 if the agent had no access.

Only an agent's owner sees or changes its MCP access (RLS). On every call the gateway and the test
chat send the agent its servers and tools in `params.metadata.guardrailHub.mcpServers` (see
`docs/agent-contract-a2a.md`); credentials never leave the hub.

