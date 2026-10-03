# Test chat (E-03) — design

Issue: #62 (E-03). Requirements: FR-10 (#14), FR-11 (#15), FR-12 (#16). Backend counterpart: #46
(B-06, Person 2). Agent protocol: A2A 1.0 as profiled in `docs/agent-contract-a2a.md`; demo
agent `apps/test-agent` (both pending on `main`). Approved by the user on 2026-10-03, including the
tests listed below.

## Goal

The panel's `/test` screen: pick an agent, chat with it through the hub's guarded path, and see
for every reply what the guardrails did (badge + trace), with token usage, limits and a way to flag
a reply. Built against a proposed B-06 endpoint that speaks A2A, degrading gracefully until it
exists.

## Scope

In scope: chat UI, agent picker, suggestion chips for the test agent's triggers, trace panel,
usage/limits, flag reply, A2A request/response parsing, the B-06/FR-12 contract text, test fake.

Out of scope: the gateway itself (B-01/B-02/B-06), deployments and guarded URLs (B-03), evaluator
scores (S-01, shown only if present), streaming, file parts (shown as "[file]"), persistence of
chats (each chat lives in the page only).

## Contract (added to `docs/api-contract-agents.md`, proposed to Person 2)

### `POST /api/v1/agents/{id}/test-chat` (B-06)

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

### `POST /api/v1/agents/{id}/flags` (FR-12)

Body `{ contextId, messageId, comment }` → 201. The owning developer sees flags later (not in this
slice).

## Parsing (`src/api/a2a.ts`)

Types for the A2A subset above (`A2AMessage`, `A2ATask`, `A2APart`, `SendMessageResponse`,
JSON-RPC envelope). `readReply(response) → Reply`:

```ts
type Verdict = 'passed' | 'redacted' | 'warned' | 'blocked' | 'error'
interface Reply {
  messageId: string
  text: string            // text parts joined with "\n"; data parts as JSON; file parts "[file]"
  verdict: Verdict
  trace: TraceEntry[]
  usage?: GuardrailHubMetadata['usage']
  limits: NonNullable<GuardrailHubMetadata['limits']>
  scores: NonNullable<GuardrailHubMetadata['scores']>
  errorMessage?: string   // JSON-RPC error or transport failure
}
```

Verdict rules, in order: JSON-RPC `error` → `error`; task in `TASK_STATE_REJECTED` or
`guardrailHub.blocked` → `blocked`; any trace entry `redact` → `redacted`; any `warn` → `warned`;
else `passed`. Task text = `artifacts[].parts` text, then `status.message.parts` (contract §3). A
task in a non-terminal state → `error` "The agent answered with an unfinished task (outside the
hub's A2A profile)."

## Page (`/test`, `src/pages/test/`)

- **Header:** "Test chat" + one line "Talk to an agent through the hub's guardrails."
- **Agent picker:** select of the user's agents (`useAgents`); empty → "Register an agent first."
  with a link to `/agents`. Changing agent or **New chat** clears the conversation and starts a
  new `contextId` (`ctx-` + random).
- **Conversation:** user bubbles right, agent bubbles left. Agent bubble: text (pre-wrapped),
  verdict badge — Passed (teal), Redacted (amber), Warned (amber), Blocked (red), Error (red);
  a **Flag reply** button. Pending reply: an agent bubble "…" with `aria-live`.
  Error bubble: the message + **Retry** (resends the same user text in the same context).
- **Composer:** textarea "Message" (Enter sends, Shift+Enter newline), **Send** (disabled while
  empty or pending); chips `#pii`, `#secret`, `#inject`, `#toxic`, `#offtopic` fill and send.
- **Trace panel** (`aria-label="Trace"`): for the selected agent reply (the latest by default;
  clicking a bubble selects it). Table: Guardrail, Stage, Verdict, Reason, Latency (+ "Simulated"
  tag). Empty trace → "No guardrails ran for this reply." Below: tokens in/out and cost when
  present; limits as labelled meters (`used / max unit`); evaluator scores when present.
  Wide screens: panel right of the chat; narrow: below, behind a **Show trace** toggle.
- **Flag reply:** opens an inline "Comment" textarea + **Send flag**; success → "Flagged";
  404/405 → "Flagging isn't available on this API yet."
- **Endpoint missing:** a 404/405 from `test-chat` shows a notice above the composer: "The test
  chat endpoint isn't available on this API yet (B-06)." and disables sending until the agent is
  changed or New chat.
- Testers see only this screen (already enforced by D-01's routing).

## Data (`src/api/testChat.ts`)

`useSendTestMessage(agentId)` (mutation: builds the JSON-RPC request with a fresh `messageId`,
posts it, returns `readReply(response)`; transport/HTTP errors become `ApiError`s handled by the
page), `useFlagReply(agentId)`.

## Testing (Vitest, explicitly approved)

Fake `test-chat` handler that behaves like the gateway in front of `apps/test-agent`:
`#pii` → redacted (output, PII), `#secret` → redacted (output, regex), `#inject` → blocked at
input (rejected task), `#toxic` → blocked at output, `#offtopic` → warned, anything else →
passed with an echo; `#error` → JSON-RPC error. Records requests.

1. `readReply` against the contract's examples: message, finished task, rejected task, JSON-RPC
   error, unfinished task.
2. Each chip gives the expected badge (E-03 acceptance).
3. Requests carry `SendMessage`, `ROLE_USER`, the same `contextId` within a chat and a new one after
   New chat / agent change.
4. Trace panel shows the selected reply's runs, usage and limits; empty-trace message.
5. Flag reply sends `{contextId, messageId, comment}`; 405 message.
6. Error bubble + Retry; endpoint-missing notice disables sending.
7. A tester sees only the Test chat screen.

Done when `pnpm lint`, `pnpm build`, `pnpm test` pass in `apps/web`.
