# Agents list and registration (D-02) — design

Issue: #55 (D-02 Agents list and registration). Requirements: FR-01 (#1), FR-13 (#4).
Backend counterpart: #34 (A-02). Contract: #29 (T-02, not landed). Date: 2026-10-03.

## Goal

Replace the `/agents` placeholder with the agents table, group filter and register form from the
"Guardrail Hub Control Panel" prototype, backed by a mock API until the real one exists.

## Scope

In scope: agents table, group filter chips and "New group", register form for proxy and runtime
agents, proxy connection test, the web app's first data layer (typed client + TanStack Query),
MSW mock API usable in dev, tests and the deployed build.

Out of scope:
- FR-01's description, auth header and request/response format fields: deferred to D-03 (#56),
  the proxy agent page.
- Editing or deleting agents (FR-02), agent detail pages (D-03/D-04).
- Persistence: mock data resets on reload.
- Team-based permissions (A-02's "developers edit only their team's agents"): no editing here.

## Decisions

- Mock API: MSW (`msw`) with handlers for the endpoints below. Screens call relative
  `fetch("/api/...")` exactly as they will against the real API.
- Mock switch: env var `VITE_API_MOCK`. The worker starts unless it is the string `"false"`, so it is
  on in dev and in the Vercel build until the real API exists. Setting `VITE_API_MOCK=false` uses
  the real `/api`. The mock modules are loaded with a dynamic import, so with the flag off they are
  not executed.
- Data fetching: `@tanstack/react-query`.
- Types are hand-written in `src/api/types.ts` and marked for replacement by T-02's generated types.

## Types (`src/api/types.ts`)

```ts
export interface Group { id: string; name: string }

interface AgentBase {
  id: string
  name: string
  groupId: string
  owner: string
  ruleCount: number
}

export interface ProxyAgent extends AgentBase {
  mode: 'proxy'
  upstreamUrl: string
  status: 'draft' | 'deployed'
  version: number | null
}

export interface RuntimeAgent extends AgentBase {
  mode: 'runtime'
  online: boolean
  lastSeenAt: string | null // ISO 8601
}

export type Agent = ProxyAgent | RuntimeAgent

export interface RegisterAgentInput {
  mode: 'proxy' | 'runtime'
  name: string
  groupId: string
  owner: string
  upstreamUrl?: string // required when mode is 'proxy'
}

export interface ConnectionResult { reachable: boolean; latencyMs?: number; error?: string }

export interface ApiErrorBody { message: string; field?: string }
```

## Endpoints

| Call | Success | Errors |
|---|---|---|
| `GET /api/agents` | 200 `Agent[]` | — |
| `GET /api/groups` | 200 `Group[]` | — |
| `POST /api/groups` `{name}` | 201 `Group` | 409 name taken; 422 empty name |
| `POST /api/agents` `RegisterAgentInput` | 201 `Agent` | 409 name taken; 422 invalid fields or unreachable proxy URL |
| `POST /api/agents/test-connection` `{upstreamUrl}` | 200 `ConnectionResult` | 422 missing URL |

Error responses use `ApiErrorBody`. Names are compared case-insensitively for uniqueness.

### Mock behaviour

- Seed groups: Customer Service (`customer-service`), Legal (`legal`), People (`people`),
  Engineering (`engineering`). New group ids are the slugified name.
- Seed agents (from the prototype):

  | id | name | mode | group | owner | details |
  |---|---|---|---|---|---|
  | `dev-agent` | dev-agent | runtime | engineering | team-alpha | online, 14 rules |
  | `demo-agent` | demo-agent | runtime | engineering | demo-team | online, 14 rules |
  | `readonly-agent` | readonly-agent | runtime | engineering | demo-team | offline, last seen 12 min before load, 7 rules |
  | `support` | Support Assistant | proxy | customer-service | demo-team | `https://support-agent.acme.internal/api/chat`, deployed v4, 6 rules |
  | `returns` | Returns Bot | proxy | customer-service | demo-team | `https://returns.acme.internal/v1/chat`, draft, 4 rules |
  | `contracts` | Contract Summarizer | proxy | legal | legal-team | `https://legal-ai.acme.internal/summarize`, deployed v2, 4 rules |
  | `hr` | HR Policy Q&A | proxy | people | people-team | `https://hr-bot.acme.internal/ask`, deployed v1, 3 rules |

- Runtime rule counts are the effective command + file rules from
  `packages/pi-control-layer/policy.json`: dev-agent has no entry (defaults: 9 command + 5 file = 14),
  demo-agent inherits both sections (14), readonly-agent replaces `commands` with 2 rules (2 + 5 = 7).
  Proxy counts are the prototype's.
- Reachability (shared by test-connection and proxy registration): a URL is reachable when it parses,
  uses `http:` or `https:`, and its host does not contain `unreachable`. Reachable results carry a
  latency between 80 and 240 ms. Unreachable results carry an error such as
  `Can't reach https://x.unreachable.test: host not found` or `Only http and https URLs are supported`.
- New proxy agents: `status: 'draft'`, `version: null`, `ruleCount: 0`.
  New runtime agents: `online: false`, `lastSeenAt: null`, `ruleCount: 0`.
  New ids are the slugified name, suffixed `-2`, `-3`… on collision.
- The mock adds a 300 ms delay in the browser only (not in tests) so loading states are visible.

## Validation (form and mock agree)

- Name: required, trimmed, unique (case-insensitive). Runtime names must match
  `^[a-z0-9][a-z0-9-]*$` because they are the `AGENT_NAME` and the `policy.json` key; error text:
  "Use lowercase letters, digits and hyphens (this becomes AGENT_NAME)". Proxy names are free text.
- Upstream URL (proxy only): required, must be an http(s) URL.
- Group: required, must exist.
- Owner: required, trimmed. Defaults to `demo-team` in the form.

## Files

| File | Purpose |
|---|---|
| `src/api/types.ts` | Types above |
| `src/api/client.ts` | `getJson<T>(path)`, `postJson<T>(path, body)`; throw `ApiError(status, message, field?)` |
| `src/api/agents.ts` | `useAgents()`, `useGroups()`, `useRegisterAgent()`, `useCreateGroup()`, `testConnection(url)`; query keys `['agents']`, `['groups']` |
| `src/api/validation.ts` | `validateRegistration(input)`, `checkReachable(url)` shared by form and mock |
| `src/mocks/db.ts` | In-memory store, seed data, `resetDb()` |
| `src/mocks/handlers.ts` | MSW handlers for the endpoints |
| `src/mocks/browser.ts` | `setupWorker(...handlers)` |
| `src/main.tsx` | Starts the worker when `VITE_API_MOCK !== 'false'`, then renders; wraps the app in `QueryClientProvider` |
| `public/mockServiceWorker.js` | Generated by `msw init` |
| `src/pages/agents/AgentsPage.tsx` | Page: header, group chips, table, states |
| `src/pages/agents/AgentsTable.tsx` | Table rows and badges |
| `src/pages/agents/GroupChips.tsx` | Chips + "New group" inline form |
| `src/pages/agents/RegisterAgentForm.tsx` | Register form |
| `src/test/server.ts` | `setupServer(...handlers)` for Vitest |

## Page behaviour

- Header: "Agents", intro "Proxy agents sit behind a guarded URL. Runtime agents run on pi and
  enforce the policy themselves.", and a **Register agent** button that opens the form inline
  above the chips. The button is hidden while the form is open; the form has Cancel.
- Group chips: "All" plus one per group, as `aria-pressed` toggle buttons. The selection is stored
  in the `group` URL search param (group id); a missing or unknown id means All.
- **New group** opens an inline text field with Save and Cancel. Save creates the group and selects
  it; a 409 shows "A group with this name already exists".
- Table columns: Agent, Mode, Group, Endpoint, Rules, Status, Owner.
  - Agent: link to `/agents/:id`.
  - Mode badge: Runtime `#E6E9F5`/`#2E3A6B`, Proxy `#F0F0EB`/`#30343B`.
  - Endpoint: proxy → upstream URL (mono); runtime → "WebSocket · connected" when online, else
    "WebSocket · last seen N min ago" from `lastSeenAt`, or "WebSocket · never connected" when null.
  - Status badge: Deployed → "Deployed · vN" teal-soft/teal-dark; Draft → "Draft" grey;
    Online → teal-soft/teal-dark; Offline → warn-bg/warn-fg.
  - The table sits in a horizontally scrollable box so the page never scrolls sideways.
- States: loading shows 4 skeleton rows; an empty group shows "No agents in this group yet";
  a failed load shows "Couldn't load agents." with a **Retry** button.

## Register form behaviour

- Mode picker: two `aria-pressed` buttons, "Proxy agent — Stateless, reached by URL" and
  "Runtime agent — pi agent that connects over WebSocket". Default: Proxy.
- Fields: Name, Upstream URL (proxy only), Group (select, defaults to the selected chip's group or
  the first group), Owner (default `demo-team`). Each has a visible label; validation messages
  appear under the field after submit and clear as the field is edited.
- Proxy: **Test connection** calls test-connection and shows "Reachable · N ms" (teal) or the error
  (danger). It does not block Register. **Register** validates, posts, and on 422/409 shows the
  server message above the buttons (or under the named field when `field` is set). On success the
  form closes, the agents list refetches, and the new row is highlighted for 3 seconds.
- Runtime: a note above the buttons shows how to start the agent:
  `AGENT_NAME=<name> POLICY_PATH=packages/pi-control-layer/policy.json pi -e packages/pi-control-layer/control-layer.ts`
  (`-e` is pi's load-extension flag), with the note that it reports to the control plane at
  `ws://localhost:4747` (`controlPlane.url` in `policy.json`). On success the form stays open in a done state with that command for the
  final name, a Copy button, and **Done** to close.
- Admin and Developer can register; testers never reach `/agents` (D-01).

## Testing

Vitest + Testing Library with a shared `msw/node` server (`listen` in setup, `resetHandlers` and
`resetDb` after each test, `onUnhandledRequest: 'error'`). A fresh `QueryClient` with retries off
per test.

1. Table shows the 7 seed agents with their status and endpoint text.
2. Selecting a chip filters rows; `/agents?group=legal` opens filtered.
3. New group: creating selects it; a duplicate name shows the 409 message.
4. Proxy: Test connection success and failure; Register with an unreachable URL is refused with
   the server message; a valid registration adds the row.
5. Runtime: rejects `Billing Bot`; a valid registration shows the start command with the name.
6. Load failure shows the error and Retry recovers.
7. `validateRegistration` and `checkReachable` unit tests.

Done when `pnpm lint`, `pnpm build` and `pnpm test` pass in `apps/web`, the lockfile is updated,
and the page is checked in the browser with the mock on.
