# acme-test-agent

A deterministic, stateless **A2A 1.0** agent for testing Guardrail Hub. It implements the hub's A2A profile ([docs/agent-contract-a2a.md](../../docs/agent-contract-a2a.md)) and needs no LLM or API key. Nothing is stored between calls; the reply depends only on the message's text.

It works with the official `a2a-sdk` client (checked with 1.2.1).

## Run

```bash
make test-agent                                     # http://127.0.0.1:8100
AGENT_AUTH_VALUE="Bearer s3cret" make test-agent    # require Authorization: Bearer s3cret
```

| Env var             | Default          | Meaning                                                            |
| ------------------- | ---------------- | ------------------------------------------------------------------ |
| `HOST` / `PORT`     | `127.0.0.1:8100` | Bind address                                                       |
| `PUBLIC_URL`        | request base URL | Base URL written into the Agent Card (set it when behind a tunnel) |
| `AGENT_AUTH_HEADER` | `Authorization`  | Header checked when auth is on                                     |
| `AGENT_AUTH_VALUE`  | unset (no auth)  | Exact header value every JSON-RPC call must send                   |

**Registering it in the hub.** The hub only accepts upstream URLs that resolve to public IPs, so `localhost` is rejected. Expose the agent first, for example with `cloudflared tunnel --url http://127.0.0.1:8100`. Start the agent with `PUBLIC_URL=https://<name>.trycloudflare.com` and register that URL.

## Endpoints

| Call                               | What it does                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `GET /.well-known/agent-card.json` | Agent Card: one `JSONRPC` interface at `/a2a`, protocol version `1.0`            |
| `POST /a2a`                        | JSON-RPC 2.0. Only `SendMessage`; requires the `A2A-Version: 1.0` header         |

Strict on purpose, so that it catches hub bugs:

| Request                                   | Answer                               |
| ----------------------------------------- | ------------------------------------ |
| `A2A-Version` missing or not `1.0`        | error `-32009` VersionNotSupported   |
| other A2A methods (`GetTask`, streaming…) | error `-32004` UnsupportedOperation  |
| unknown method (e.g. 0.3's `message/send`)| error `-32601` Method not found      |
| malformed message or part                 | error `-32602` Invalid params        |
| body is not JSON                          | error `-32700` Parse error           |
| wrong or missing auth header              | HTTP 401                             |

Replies are `{"message": {...}}` with `role: "ROLE_AGENT"`, the caller's `contextId` (a new one if it sent none) and `metadata.usage = {inputTokens, outputTokens}`.

```bash
curl -s localhost:8100/a2a -H 'content-type: application/json' -H 'A2A-Version: 1.0' -d '{
  "jsonrpc": "2.0", "id": 1, "method": "SendMessage",
  "params": {"message": {"messageId": "m1", "role": "ROLE_USER", "parts": [{"text": "#pii"}]}}}'
```

## Triggers

Start the user message with one of these:

| Trigger     | Reply                                                       | Tests                                |
| ----------- | ----------------------------------------------------------- | ------------------------------------ |
| `#pii`      | email, phone, card number, IBAN                             | PII guardrail on output              |
| `#secret`   | AWS key, `api_key = …`                                      | regex / redaction                    |
| `#inject`   | "Ignore all previous instructions…", `curl … \| sh`         | prompt-injection signatures          |
| `#toxic`    | an insult                                                   | toxicity                             |
| `#offtopic` | elections and crypto                                        | topic deny list                      |
| `#context`  | echoes the parts tagged `metadata.guardrailHub`             | governance prompt and context        |
| `#slow N`   | waits N s (max 60)                                          | per-call time limit                  |
| `#long N`   | N words (max 20000)                                         | token / cost budget                  |
| `#task`     | a `TASK_STATE_COMPLETED` task with an artifact             | hub reads task replies               |
| `#working`  | a `TASK_STATE_WORKING` task                                 | hub rejects replies outside the profile |
| `#error`    | JSON-RPC error `-32603`                                     | upstream errors pass through         |
| `#crash`    | HTTP 500                                                    | fail-closed behaviour                |
| `#help`     | this list                                                   |                                      |

Anything else comes back as `Echo: <message>`, so you can test input guardrails with any text.
