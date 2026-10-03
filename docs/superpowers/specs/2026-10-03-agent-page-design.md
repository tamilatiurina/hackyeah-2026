# Agent page (D-03, first slice) — design

Issue: #56 (D-03). Requirements: FR-02 (#9), FR-05 (#10), FR-06 (#11). Backend owners: Person 3
(agent config; `fr-05-attached-dettached-policies-guardrails` defines `RuleAttachment`).
Approved by the user on 2026-10-03.

## Goal

Replace the `/agents/:agentId` placeholder with an agent page on real data (overview from
`GET /agents/{id}`), plus edit, delete and attached guardrails built against a proposed API contract,
degrading to "not available yet" until the backend implements it.

## Scope

In scope: overview, not-found/error states, edit (incl. auth header keep/replace/remove), delete,
attached-guardrails section (mandatory locked group, attach, reorder, remove, save), the API contract
document, a shared agent-fields component used by register and edit.

Out of scope: context, limits and deploy tabs (D-03 later slices; B-03), test chat (E-03),
policies (`rule_type: "policy"` — FR-04 is "Won't have"), the backend itself.

## API contract (`docs/api-contract-agents.md`, proposed to Person 3)

All under `/api/v1`, Bearer token required, errors as FastAPI `{detail}`.

```ts
interface RuleAttachment { rule_id: string; rule_type: 'guardrail' | 'policy'; order_index: number }
interface Agent {
  id: string; name: string; description: string; upstream_url: string
  auth_header_name: string | null; request_format: 'json' | 'text'; response_format: 'json' | 'text'
  attached_rules?: RuleAttachment[]   // new; absent = backend doesn't support attachments yet
  config_version?: number             // new (column exists in the agents table)
}
interface AgentUpdate {               // PATCH body, all optional
  name?: string; description?: string; upstream_url?: string
  request_format?: 'json' | 'text'; response_format?: 'json' | 'text'
  auth_header?: { name: string; value: string } | null   // object = replace, null = remove, omitted = keep
  attached_rules?: { rule_id: string; rule_type: 'guardrail' }[]   // full list; array order = execution order
}
// Guardrail gains: is_mandatory?: boolean (named by the backend, fr-06) — applies to every agent, never listed in attached_rules.
```

| Call | Success | Errors |
|---|---|---|
| `GET /agents/{id}` | 200 `Agent` | 404 "Agent not found"; 422 malformed id |
| `PATCH /agents/{id}` `AgentUpdate` | 200 `Agent` (`config_version` + 1) | 404; 409 "An agent with this name already exists"; 422; 502 when a changed `upstream_url` doesn't answer |
| `DELETE /agents/{id}` | 204 | 404 |

## Page (`src/pages/agent/`)

- `AgentPage` at `/agents/:agentId` (replaces the placeholder route).
- Header: "← Agents" link to `/agents`, `<h1>` agent name, **Edit** and **Delete** buttons.
- Overview (`<dl>`): Description ("—" when empty), Upstream URL (mono), Formats ("JSON → Text"),
  Auth header (name in mono or "None" — never the value), ID (mono), Config version (only when
  present).
- States: skeleton while loading; 404 or 422 → "Agent not found" + link "Back to agents";
  other errors → "Couldn't load this agent." + **Retry**.

### Edit

- Opens inline in place of the overview; focus moves to Name; Cancel/Save; on close focus returns to
  **Edit**.
- Fields: shared `AgentFields` (Name, Description, Upstream URL, Request format, Response format) —
  also used by `RegisterAgentForm`.
- Auth header: radio group "Auth header" — **Keep current** (only when the agent has one; default
  then), **Replace** (shows Header name, default current name or `Authorization`, and Header value,
  `type="password"`), **Remove** (only when it has one), **None** (when it has none; default then),
  **Add** (when it has none: same fields as Replace).
- Sends only changed fields (`auth_header` only for replace/add/remove). Nothing changed → closes
  without a request.
- Validation: same rules as registration (`validateAgentForm`).
- Errors: 409 → under Name; 502 → "Couldn't reach the upstream agent. Check the URL and that it
  answers GET requests."; 405 → "Editing agents isn't available on this API yet."; others → message
  above the buttons.
- Success: overview shows the returned agent; the agents list cache is updated.

### Delete

- **Delete** → **Confirm delete** (autofocus; blur or 5 s cancels).
- 204 → navigate to `/agents`; the agent is removed from the list cache.
- 405 → "Deleting agents isn't available on this API yet."; other errors shown in the header.

### Guardrails section

- Heading "Guardrails"; loads the library with `useGuardrails()`.
- If `attached_rules` is absent: "Attaching guardrails isn't available on this API yet." (still shows
  the mandatory group when guardrails report `is_mandatory`).
- **Always applied**: guardrails with `is_mandatory: true`, lock icon, badges (engine, stage, action),
  no controls.
- **Attached** (`rule_type === 'guardrail'`, sorted by `order_index`): position number, name,
  badges, **Move up** / **Move down** (disabled at the ends), **Remove**. Unknown `rule_id` → "Unknown
  guardrail (id)" row that can still be removed. Mandatory guardrails are never offered for attach.
- **Attach guardrail**: a select of enabled, non-mandatory, not-yet-attached guardrails + **Attach**
  (appends to the end).
- Changes are local until **Save guardrails** (shown with "Unsaved changes" when the list differs);
  **Discard** resets. Save sends `PATCH {attached_rules}` with the guardrail rules in order
  (policies in `attached_rules` are passed through unchanged at the end). 405 → "Attaching guardrails
  isn't available on this API yet."
- Empty attached list: "No guardrails attached. Only the mandatory ones run."

## Data layer

- `src/api/types.ts`: `RuleAttachment`, `AgentUpdate`; `Agent` gains optional `attached_rules`,
  `config_version`; `Guardrail` gains optional `is_mandatory`.
- `src/api/agents.ts`: `useAgent(id)` (query `['agents', id]`), `useUpdateAgent(id)` (writes the
  detail cache and replaces the row in `['agents']`), `useDeleteAgent()` (removes from caches).
- `src/test/fakeApi.ts`: `GET/PATCH/DELETE /agents/:id` with the contract's behaviour;
  `fakeApi.agentsSupport = { update: true, delete: true, attachments: true }` switches let tests
  simulate the current backend (405s, no `attached_rules`); guardrail seeds get one
  `is_mandatory: true` guardrail.

## Testing

1. Overview renders all fields, never the header value; not-found and error/Retry states.
2. Edit: change name and formats → PATCH body has only those; keep/replace/remove auth header bodies;
   409 under Name; 405 message; unchanged form closes without a request; focus returns to Edit.
3. Delete: confirm → back on `/agents` without the row; 405 message.
4. Guardrails: mandatory locked group; attach, move up/down, remove, Save → PATCH body order;
   Discard; "not available yet" when `attached_rules` is absent.
5. Register form still passes its tests after extracting `AgentFields`.

Done when `pnpm lint`, `pnpm build`, `pnpm test` pass in `apps/web`.
