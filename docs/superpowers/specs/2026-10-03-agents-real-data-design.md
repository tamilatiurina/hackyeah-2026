# Agents page on real data, with Supabase sign-in — design

Follows D-02 (#55, PR #73) and the agents API from #78. Requirements: FR-01 (#1). Date: 2026-10-03.
Approved by the user on 2026-10-03.

## Goal

Replace the MSW-mocked agents on `/agents` with the real, database-backed agents API. That API
needs a Supabase user access token, so the web app gains a Supabase email/password sign-in.

## Scope

In scope:
- Supabase sign-in (`@supabase/supabase-js`), session handling, sign-out, route guard.
- Bearer token on every API request; a 401 signs the user out.
- Agents table and register form rebuilt on the real API's shapes (FR-01 fields).
- Removal of the browser MSW mock (`src/mocks/`, `public/mockServiceWorker.js`, `VITE_API_MOCK`).

Out of scope:
- Groups, runtime agents, owner, rule counts, deploy status/version (not in the API; removed from
  the page until the API supports them).
- Sign-up, password reset (accounts come from Supabase; locally `make supabase` creates
  `demo@guardrail.local`).
- Agent detail pages (D-03/D-04) — `/agents/:id` stays a placeholder.
- Connecting the deployed Vercel app to a hosted Supabase project.

## Real API (from #78, under `/api/v1`, all calls need `Authorization: Bearer <token>`)

| Call | Success | Errors (`{detail}`) |
|---|---|---|
| `GET /agents` | 200 `{data: Agent[], total}` (newest first) | 401 no/invalid token; 503 |
| `POST /agents` `AgentRegistration` | 201 `Agent` | 401; 409 "An agent with this name already exists"; 422 validation / constraint / unsafe URL; 502 "Upstream agent did not respond successfully"; 503 |
| `GET /agents/{id}` | 200 `Agent` | 401; 404; 503 |

```ts
type MessageFormat = 'json' | 'text'
interface Agent {
  id: string
  name: string
  description: string
  upstream_url: string
  auth_header_name: string | null
  request_format: MessageFormat
  response_format: MessageFormat
}
interface AgentRegistration {
  name: string              // 1–100
  description: string       // ≤ 1000 (may be empty)
  upstream_url: string      // http(s)
  auth_header?: { name: string; value: string } | null
  request_format: MessageFormat
  response_format: MessageFormat
}
```

Registration does a real `GET` to the upstream before saving (and refuses non-public addresses).

## Auth (`src/auth/`)

- `supabase.ts`: `createSupabaseClient()` from `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`;
  returns `null` when either is missing.
- `AuthClient` interface (the subset of `supabase.auth` used): `getSession()`,
  `onAuthStateChange(cb)`, `signInWithPassword({email, password})`, `signOut()`. Tests pass a fake.
- `AuthProvider({ client })`: state `{ status: 'loading' | 'signed-in' | 'signed-out', session,
  configured }`; `signIn(email, password)` returns an error message or `null`; `signOut()`.
  Registers the token with the API client and the 401 handler.
- `useAuth()` hook.
- `RequireAuth`: while loading shows nothing; signed out → `<Navigate to="/sign-in" state={{from}}>`.
- `/sign-in` page (outside the app layout): heading "Sign in to Guardrail Hub", Email and Password
  fields, **Sign in** button (disabled while pending), Supabase's error message shown in a
  `role="alert"`, an optional notice from navigation state (e.g. "Your session expired. Sign in
  again."). When `configured` is false: "Supabase isn't configured. Set VITE_SUPABASE_URL and
  VITE_SUPABASE_ANON_KEY in apps/web/.env.local (make supabase writes them)." and no form. After
  sign-in, go to `from` or the role's home. Signed-in users visiting `/sign-in` are redirected home.
- Sidebar: signed-in email and a **Sign out** button above the role switcher.

## API client (`src/api/client.ts`)

- `setAccessTokenProvider(fn: () => string | null)`: when it returns a token, every request sends
  `Authorization: Bearer <token>` (merged with call headers).
- `setUnauthorizedHandler(fn: () => void)`: called on any 401 response (before throwing the
  `ApiError`). The AuthProvider's handler signs out and navigates to `/sign-in` with the notice
  "Your session expired. Sign in again.".

## Agents page

- Types in `src/api/types.ts` replace the D-02 agent types (`Agent`, `AgentRegistration`,
  `MessageFormat`, `AgentList`); `Group`, `ProxyAgent`, `RuntimeAgent`, `ConnectionResult` and
  `RegisterAgentInput` are removed.
- Hooks (`src/api/agents.ts`): `useAgents()` → `Agent[]` (unwraps `data`), `useRegisterAgent()`
  (prepends the new agent to the cache, then invalidates). `useGroups`, `useCreateGroup`,
  `testConnection` are removed.
- Header and intro: "Agents" / "Proxy agents sit behind a guarded URL. Register one by its
  upstream URL; the hub checks it answers before saving." **Register agent** shows once agents
  loaded (focus handling as before).
- Table columns: **Agent** (link to `/agents/:id`), **Description** (muted, "—" when empty),
  **Endpoint** (mono), **Formats** (`JSON → Text`), **Auth header** (name in mono, or "None").
  Scrolls inside its box below 880 px.
- States: skeleton while loading; "No agents yet. Register your first one." when empty;
  "Couldn't load agents." + Retry on error.
- Register form fields: Name, Description (textarea), Upstream URL, Request format, Response
  format (selects: JSON / Text, default JSON), "Send an auth header" checkbox → Header name
  (default `Authorization`) and Header value (`type="password"`). Client checks: name 1–100 after
  trim; description ≤ 1000; URL http(s); header name non-empty and value non-empty when the checkbox
  is on. Error display: 409 under Name; 502 above the buttons as "Couldn't reach the upstream agent.
  Check the URL and that it answers GET requests."; other errors above the buttons with the server
  message. On success the form closes, the row is highlighted for 3 s, focus returns to
  **Register agent**.
- `GroupChips`, the runtime start command and `agentDisplay`'s status/endpoint helpers go away;
  `agentDisplay.ts` keeps `formatLabel(format)`.

## Browser mock removal

- Delete `src/mocks/` and `public/mockServiceWorker.js`; `main.tsx` renders directly (no worker);
  drop `VITE_API_MOCK` from `env.d.ts` and the oxlint ignore entry. `msw` stays a dev dependency
  for tests.
- `src/test/fakeApi.ts` gains the agents endpoints with the real API's behaviour: Bearer required
  (401 `{"detail": "Not authenticated"}`), `{data, total}` newest first, 409 duplicate name (exact,
  per user), 422 bad URL, 502 for hosts containing `unreachable`.
- `renderApp(path, { role?, signedIn = true })` wraps the app in `AuthProvider` with a fake auth
  client (`src/test/fakeAuth.ts`); the default is signed in as `demo@guardrail.local` with token
  `test-token`.

## Testing

1. Client: sends the Bearer token from the provider; calls the 401 handler.
2. Auth: signed-out visit redirects to `/sign-in`, then back after sign-in; wrong password shows
   the error; Sign out returns to `/sign-in`; a 401 from the API signs out with the expiry
   notice; unconfigured Supabase shows the setup message.
3. Agents page: lists API agents with the new columns; empty and error states.
4. Register: success adds a highlighted row and returns focus; 409 under Name; 502 message; auth
   header fields toggle and are required when on; the header value is a password input and is sent
   as `auth_header`.

Done when `pnpm lint`, `pnpm build`, `pnpm test` pass in `apps/web`, and the page is checked in the
browser signed in as `demo@guardrail.local` against `make supabase` + `make api`.
