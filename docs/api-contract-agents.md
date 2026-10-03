# Agents API — proposed additions (FR-02, FR-05, FR-06)

Proposed by the frontend for the agent page (D-03). All under `/api/v1`, Bearer token required,
errors as FastAPI `{"detail": ...}`. Matches `RuleAttachment` from the
`fr-05-attached-dettached-policies-guardrails` branch.

```ts
interface RuleAttachment { rule_id: string; rule_type: 'guardrail' | 'policy'; order_index: number }

interface Agent {
  id: string
  name: string
  description: string
  upstream_url: string
  auth_header_name: string | null
  request_format: 'json' | 'text'
  response_format: 'json' | 'text'
  attached_rules?: RuleAttachment[]  // NEW; ordered by order_index
  config_version?: number            // NEW; the agents table already has the column
}

interface AgentUpdate {              // PATCH body; every field optional
  name?: string
  description?: string
  upstream_url?: string
  request_format?: 'json' | 'text'
  response_format?: 'json' | 'text'
  auth_header?: { name: string; value: string } | null  // object = replace, null = remove, omitted = keep
  attached_rules?: { rule_id: string; rule_type: 'guardrail' | 'policy' }[]  // full list; array order = order_index
}

// Guardrail gains:
interface Guardrail { /* … */ is_mandatory?: boolean }  // applies to every agent; never stored in attached_rules (field name from the merged fr-06 work)
```

| Call | Success | Errors |
|---|---|---|
| `GET /agents/{id}` | 200 `Agent` (incl. `attached_rules`, `config_version`) | 404 "Agent not found"; 422 malformed id |
| `PATCH /agents/{id}` | 200 `Agent`, `config_version` + 1 | 404; 409 "An agent with this name already exists"; 422 validation; 502 when a changed `upstream_url` doesn't answer GET |
| `DELETE /agents/{id}` | 204 | 404 |

Until these exist the web app shows "… isn't available on this API yet" (it treats 405 and a missing
`attached_rules` as "not implemented").

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
