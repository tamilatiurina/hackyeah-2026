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
