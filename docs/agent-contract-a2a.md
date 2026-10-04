# Agent contract: A2A 1.0

Every agent registered in Guardrail Hub speaks the [A2A protocol](https://a2a-protocol.org/v1.0.0/specification/) version **1.0** over its **JSON-RPC** binding. The hub calls agents with it, and the guarded URL exposes the same protocol, so a client app switches to the guarded agent by changing one URL. This replaces the earlier "pi harness message format". pi coding agents are not part of this project; they get a separate feature.

This document is the hub's **profile** of A2A: the subset the hub relies on, plus a few conventions for things A2A leaves open. Anything not mentioned follows the spec. The normative types are in [`a2a.proto`](https://github.com/a2aproject/A2A/blob/main/specification/a2a.proto); JSON uses its camelCase field names.

## 1. Discovery and registration

An agent publishes its Agent Card at `GET {baseUrl}/.well-known/agent-card.json`.

```json
{
  "name": "Support Assistant",
  "description": "Answers questions about orders and returns.",
  "version": "1.0.0",
  "supportedInterfaces": [
    { "url": "https://support.example.com/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" }
  ],
  "capabilities": { "streaming": false, "pushNotifications": false },
  "securitySchemes": {
    "bearer": { "httpAuthSecurityScheme": { "scheme": "Bearer" } }
  },
  "securityRequirements": [{ "schemes": { "bearer": { "list": [] } } }],
  "defaultInputModes": ["text/plain"],
  "defaultOutputModes": ["text/plain"],
  "skills": [
    { "id": "orders", "name": "Orders and returns", "description": "Order status, returns policy.", "tags": ["support"] }
  ]
}
```

Registering an agent (FR-01) means:

1. The developer enters the **base URL** and, optionally, an **auth header** (name and value) that the hub sends on every call.
2. The hub fetches the Agent Card with that header. This replaces the old "ping the URL" check.
3. The card must have the fields the spec marks as required (`name`, `description`, `version`, `supportedInterfaces`, `capabilities`, `defaultInputModes`, `defaultOutputModes`, `skills`), plus one interface with `protocolBinding: "JSONRPC"` and `protocolVersion: "1.0"`. That interface's `url` becomes the upstream endpoint.
4. The hub stores a snapshot of the card. Name and description default to the card's values.

The old `request_format` / `response_format` (JSON or text) fields go away: A2A fixes the wire format.

## 2. Calling an agent

The hub sends one JSON-RPC 2.0 request per user message:

```http
POST https://support.example.com/a2a
Content-Type: application/json
A2A-Version: 1.0
Authorization: Bearer <stored secret>
```

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "SendMessage",
  "params": {
    "message": {
      "messageId": "9a0c…",
      "contextId": "ctx-42",
      "role": "ROLE_USER",
      "parts": [{ "text": "Where is my order 1234?" }]
    },
    "configuration": { "acceptedOutputModes": ["text/plain"] }
  }
}
```

The hub only uses `SendMessage`. It never calls `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask` or the push-notification methods, so an agent only has to implement `SendMessage`.

## 3. Agent replies

The JSON-RPC `result` is a `SendMessageResponse`, which holds **either** a `message` **or** a `task`.

**Message (preferred for stateless agents):**

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "result": {
    "message": {
      "messageId": "b71e…",
      "contextId": "ctx-42",
      "role": "ROLE_AGENT",
      "parts": [{ "text": "Order 1234 shipped yesterday." }],
      "metadata": { "usage": { "inputTokens": 12, "outputTokens": 7 } }
    }
  }
}
```

**Task, already finished:** accepted when `status.state` is terminal: `TASK_STATE_COMPLETED`, `TASK_STATE_FAILED`, `TASK_STATE_CANCELED` or `TASK_STATE_REJECTED`. The reply text is the text parts of `artifacts[].parts`, then `status.message.parts`.

A task in a non-terminal state (`SUBMITTED`, `WORKING`, `INPUT_REQUIRED`, `AUTH_REQUIRED`) is outside the profile. The hub treats it as an invalid agent response, because it doesn't poll or subscribe for updates.

A JSON-RPC `error` from the agent is passed through to the caller and logged.

## 4. Hub conventions (where A2A is silent)

- **Text that guardrails check.** A guardrail sees the `text` parts of a message, joined with newlines. `data` parts are checked as their JSON serialization. `raw` and `url` (file) parts pass through unchecked, and the trace says so.
- **Statelessness and sessions.** The hub stores no conversation content. It forwards one message per call; any memory of earlier turns is up to the agent, keyed by `contextId`. The hub uses `contextId` as the **session key** for its counters (turns, tokens, cost, elapsed time) and for per-session limits (FR-25, FR-26, FR-36). If the caller sends no `contextId`, the hub generates one and returns it.
- **Governance prompt and context.** A2A has no system role. The hub adds the governance prompt and the agent's context (FR-14, FR-32) as **leading text parts** of the user message, governance first, then context. Each one is tagged in part metadata: `{"text": "…", "metadata": {"guardrailHub": "governance"}}` or `"context"`. Agents that ignore metadata just see extra text before the user's message.
- **MCP servers.** The MCP servers an agent may use, and which of their tools (FR-17), go in `params.metadata.guardrailHub.mcpServers`: a list of `{"id", "name", "url", "allowedTools": ["…"]}`, set on every forwarded call (guarded URL and test chat) when the agent has any. Credentials are never sent; the key stays in the hub. With no MCP access the field is absent.
- **Token usage.** A2A has no usage field. When a reply message or task carries `metadata.usage = {"inputTokens": n, "outputTokens": m}`, the hub uses those numbers. Otherwise it estimates tokens from the text. Cost is the token count priced from the hub's price table (FR-25).
- **Timeouts.** The per-call time limit (FR-26) cancels the upstream HTTP request. The caller gets JSON-RPC error `-32603` with `data.reason = "timeout"`.

## 5. The guarded URL (FR-08)

Each deployment gets two routes on the shared gateway:

- `GET {gateway}/a/{slug}/.well-known/agent-card.json` returns the upstream card with these changes: `supportedInterfaces` lists only the gateway's own JSON-RPC interface (`{gateway}/a/{slug}`, `protocolVersion` `"1.0"`); `capabilities.streaming` and `capabilities.pushNotifications` are `false`; and `securitySchemes` / `securityRequirements` are replaced by the deployment's API key:

  ```json
  "securitySchemes": { "hubKey": { "apiKeySecurityScheme": { "location": "header", "name": "X-API-Key" } } },
  "securityRequirements": [{ "schemes": { "hubKey": { "list": [] } } }]
  ```

- `POST {gateway}/a/{slug}` accepts the same `SendMessage` request an agent does:
  1. A missing or wrong `X-API-Key` returns HTTP 401.
  2. Methods other than `SendMessage` return JSON-RPC error `-32004` (`UnsupportedOperationError`).
  3. Input guardrails run on the user message. **Redact** rewrites the text parts before forwarding. **Block** answers without calling the agent (see below).
  4. The request is forwarded upstream with the stored auth header.
  5. Output guardrails run on the reply text. **Redact** rewrites it; **block** replaces the reply.
  6. The trace (FR-11) goes in the reply's `metadata.guardrailHub.trace`. Clients that don't know it ignore it.

  A **blocked** call returns a task the caller can read as a refusal:

  ```json
  {
    "jsonrpc": "2.0",
    "id": "req-1",
    "result": {
      "task": {
        "id": "blk-5f2c…",
        "contextId": "ctx-42",
        "status": {
          "state": "TASK_STATE_REJECTED",
          "message": {
            "messageId": "c9d4…",
            "role": "ROLE_AGENT",
            "parts": [{ "text": "Blocked by guardrail \"Prompt injection\": ignore-instructions signature matched." }]
          }
        },
        "metadata": { "guardrailHub": { "blocked": true, "stage": "input", "trace": [] } }
      }
    }
  }
  ```

## 6. Out of scope for the MVP

Streaming (`SendStreamingMessage`), long-running tasks, push notifications, the extended Agent Card, the gRPC and HTTP+JSON bindings, A2A versions other than 1.0, and checking file parts.

## Reference implementation

`apps/test-agent` is a deterministic A2A 1.0 agent that implements this profile, with trigger messages that set off each guardrail type. Use it to test registration, the gateway and the test chat.
