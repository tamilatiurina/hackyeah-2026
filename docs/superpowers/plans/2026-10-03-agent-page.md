# Agent Page (D-03, first slice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/agents/:agentId` placeholder with an agent page: overview from the real API, plus edit, delete and attached guardrails built against a proposed contract that degrades gracefully until the backend implements it.

**Architecture:** `src/pages/agent/` holds the page (`AgentPage`), its overview, the edit form and the guardrails section. A shared `AgentFields` component (extracted from `RegisterAgentForm`) renders the agent's core fields for both register and edit. Hooks in `src/api/agents.ts` add detail/update/delete. The test fake API implements the contract with switches that simulate today's backend (405s, no `attached_rules`).

**Tech Stack:** React 19, TypeScript 6, react-router v8, TanStack Query 5, MSW 3 (tests), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-03-agent-page-design.md`

## Global Constraints

- pnpm only, inside `apps/web`; TypeScript only; no `any`; API paths via `client.ts` (`/agents/...`).
- Never render or log the auth header value; the edit form only sends it when replacing/adding.
- Texts exactly: "Agent not found", "Back to agents", "Couldn't load this agent.", "Editing agents isn't available on this API yet.", "Deleting agents isn't available on this API yet.", "Attaching guardrails isn't available on this API yet.", "Couldn't reach the upstream agent. Check the URL and that it answers GET requests.", "No guardrails attached. Only the mandatory ones run.", "Always applied", "Unsaved changes".
- Do not commit the user's uncommitted `Makefile`, `pyproject.toml`, `uv.lock` changes: always `git add` explicit paths.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. API normalises `upstream_url` (e.g. adds a trailing slash); an untouched URL must not be sent as a change. Pinned in Task 2 ("sends only the changed fields").
2. Editing the name to another agent's name → 409 must land under Name, not as a generic error. Pinned in Task 2.
3. Reordering then discarding must restore the saved order exactly; saving must keep policy rules (not shown) intact. Pinned in Task 4.
4. A mandatory guardrail must never be offered for attaching, even if the agent has it in `attached_rules`. Pinned in Task 4.
5. Deleting must leave the user on `/agents` with the row gone — no flash of "Agent not found". Pinned in Task 3.

---

## File Structure

```
docs/api-contract-agents.md                 proposed contract for Person 3
apps/web/src/
  api/types.ts                              + RuleAttachment, AgentUpdate; Agent/Guardrail optional fields
  api/agents.ts                             + useAgent, useUpdateAgent, useDeleteAgent
  pages/agents/AgentFields.tsx              Field, AgentFields, UNREACHABLE (shared)
  pages/agents/RegisterAgentForm.tsx        uses AgentFields
  pages/agent/AgentPage.tsx                 route component, header, delete, states
  pages/agent/AgentOverview.tsx             <dl> of agent fields
  pages/agent/EditAgentForm.tsx             edit form incl. auth header modes
  pages/agent/AgentGuardrails.tsx           mandatory + attached guardrails
  pages/agent/*.test.tsx                    tests
  app/AppRoutes.tsx                         /agents/:agentId → AgentPage
  test/fakeApi.ts                           + /agents/:id GET/PATCH/DELETE, agentsSupport, mandatory seed
```

---

### Task 1: Contract, data layer, page with overview and states

**Files:**
- Create: `docs/api-contract-agents.md`, `apps/web/src/pages/agent/AgentPage.tsx`, `apps/web/src/pages/agent/AgentOverview.tsx`
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/api/agents.ts`, `apps/web/src/test/fakeApi.ts`, `apps/web/src/app/AppRoutes.tsx`
- Test: `apps/web/src/pages/agent/AgentPage.test.tsx`

**Interfaces:**
- Produces: `RuleAttachment`, `AgentRuleRef = { rule_id: string; rule_type: 'guardrail' | 'policy' }`, `AgentUpdate`; `Agent.attached_rules?`, `Agent.config_version?`, `Guardrail.mandatory?`; `useAgent(id)`, `useUpdateAgent(id)`, `useDeleteAgent()`; `fakeApi.agentsSupport`, `fakeApi.lastAgentUpdate`; `AgentPage` (exports nothing else); `AgentOverview({ agent })`.

- [ ] **Step 1: Contract document**

Create `docs/api-contract-agents.md`:

````markdown
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
interface Guardrail { /* … */ mandatory?: boolean }  // applies to every agent; never stored in attached_rules
```

| Call | Success | Errors |
|---|---|---|
| `GET /agents/{id}` | 200 `Agent` (incl. `attached_rules`, `config_version`) | 404 "Agent not found"; 422 malformed id |
| `PATCH /agents/{id}` | 200 `Agent`, `config_version` + 1 | 404; 409 "An agent with this name already exists"; 422 validation; 502 when a changed `upstream_url` doesn't answer GET |
| `DELETE /agents/{id}` | 204 | 404 |

Until these exist the web app shows "… isn't available on this API yet" (it treats 405 and a missing
`attached_rules` as "not implemented").
````

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/pages/agent/AgentPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const overview = () => screen.getByRole('region', { name: 'Overview' })

describe('AgentPage', () => {
  it('shows the agent overview from the API', async () => {
    renderApp('/agents/agent-support')
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
    const o = within(overview())
    expect(o.getByText('Answers order questions.')).toBeInTheDocument()
    expect(o.getByText('https://support-agent.acme.example/api/chat')).toBeInTheDocument()
    expect(o.getByText('JSON → JSON')).toBeInTheDocument()
    expect(o.getByText('Authorization')).toBeInTheDocument()
    expect(o.getByText('agent-support')).toBeInTheDocument()
    expect(o.getByText('1')).toBeInTheDocument() // config version
    expect(screen.getByRole('link', { name: '← Agents' })).toHaveAttribute('href', '/agents')
  })

  it('shows dashes and None for an agent without description or auth header', async () => {
    renderApp('/agents/agent-contracts')
    await screen.findByRole('heading', { level: 1, name: 'Contract Summarizer' })
    expect(within(overview()).getByText('—')).toBeInTheDocument()
    expect(within(overview()).getByText('None')).toBeInTheDocument()
  })

  it('hides the config version when the API does not send it', async () => {
    fakeApi.agents[0] = { ...fakeApi.agents[0], config_version: undefined }
    renderApp('/agents/agent-support')
    await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
    expect(within(overview()).queryByText('Config version')).not.toBeInTheDocument()
  })

  it('shows not found for an unknown agent', async () => {
    renderApp('/agents/nope')
    expect(await screen.findByRole('heading', { name: 'Agent not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to agents' })).toHaveAttribute('href', '/agents')
  })

  it('treats a malformed id (422) as not found', async () => {
    server.use(
      http.get(apiPath('/agents/:id'), () =>
        HttpResponse.json({ detail: [{ type: 'uuid_parsing', loc: ['path', 'agent_id'], msg: 'bad', input: 'x' }] }, { status: 422 }),
      ),
    )
    renderApp('/agents/x')
    expect(await screen.findByRole('heading', { name: 'Agent not found' })).toBeInTheDocument()
  })

  it('shows an error with a working Retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiPath('/agents/:id'), () => HttpResponse.json({ detail: 'Could not read agents' }, { status: 503 }), {
        once: true,
      }),
    )
    renderApp('/agents/agent-support')
    expect(await screen.findByText("Couldn't load this agent.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
  })

  it('is reached from the agents table', async () => {
    const user = userEvent.setup()
    renderApp('/agents')
    await user.click(await screen.findByRole('link', { name: 'Support Assistant' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agent`
Expected: FAIL — the route renders the "Agent" placeholder; no overview.

- [ ] **Step 4: Types and hooks**

In `apps/web/src/api/types.ts`, after `AgentList`, add:

```ts
export interface RuleAttachment {
  rule_id: string
  rule_type: 'guardrail' | 'policy'
  order_index: number
}

export type AgentRuleRef = Pick<RuleAttachment, 'rule_id' | 'rule_type'>

/** PATCH /agents/{id} body (proposed, docs/api-contract-agents.md). */
export interface AgentUpdate {
  name?: string
  description?: string
  upstream_url?: string
  request_format?: MessageFormat
  response_format?: MessageFormat
  /** Object replaces, null removes, omitted keeps. */
  auth_header?: { name: string; value: string } | null
  /** Full list; array order is the execution order. */
  attached_rules?: AgentRuleRef[]
}
```

and add to `interface Agent` (after `response_format`):

```ts
  /** Absent until the backend supports attachments (FR-05). */
  attached_rules?: RuleAttachment[]
  config_version?: number
```

and to `interface Guardrail` (after `enabled: boolean`):

```ts
  /** FR-06: applies to every agent; never listed in attached_rules. */
  mandatory?: boolean
```

Replace `apps/web/src/api/agents.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { deleteJson, getJson, patchJson, postJson } from './client'
import type { Agent, AgentList, AgentRegistration, AgentUpdate } from './types'

export const agentKeys = {
  agents: ['agents'] as const,
  agent: (id: string) => ['agents', id] as const,
}

const enc = encodeURIComponent

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: async () => (await getJson<AgentList>('/agents')).data,
  })
}

export function useAgent(id: string) {
  return useQuery({ queryKey: agentKeys.agent(id), queryFn: () => getJson<Agent>(`/agents/${enc(id)}`) })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (registration: AgentRegistration) => postJson<Agent>('/agents', registration),
    onSuccess: (agent) => {
      // The API lists newest first.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => [agent, ...(old ?? [])])
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents, exact: true })
    },
  })
}

export function useUpdateAgent(id: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (changes: AgentUpdate) => patchJson<Agent>(`/agents/${enc(id)}`, changes),
    onSuccess: (agent) => {
      queryClient.setQueryData(agentKeys.agent(id), agent)
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => old?.map((a) => (a.id === agent.id ? agent : a)))
    },
  })
}

export function useDeleteAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => deleteJson(`/agents/${enc(id)}`),
    onSuccess: (_, id) => {
      // The detail query is left alone: removing it while the page is still mounted would refetch → 404.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => old?.filter((a) => a.id !== id))
    },
  })
}
```

(`exact: true` on the register invalidation keeps it from refetching every open agent detail.)

- [ ] **Step 5: Fake API**

In `apps/web/src/test/fakeApi.ts`:
- import `AgentUpdate` with the other types;
- in `seedAgents()`, give both agents `config_version: 1`, and the support agent `attached_rules: [{ rule_id: 'gr-pii', rule_type: 'guardrail', order_index: 0 }]`, the contracts agent `attached_rules: []`;
- in `seedGuardrails()`, add `mandatory: true` to `gr-injection` (the others stay without the field);
- add to the state object and to `resetFakeApi()`:
  `agentsSupport: { update: true, delete: true, attachments: true }` and `lastAgentUpdate: null as AgentUpdate | null` (reset to these values);
- add helpers after `notAuthenticated`:

```ts
// Shape the response like a backend that may not support attachments yet.
function present(agent: Agent): Agent {
  if (fakeApi.agentsSupport.attachments) return agent
  const { attached_rules: _omit, ...rest } = agent
  return rest
}

const methodNotAllowed = () => detail(405, 'Method Not Allowed')
```

- in the `GET /agents` handler return `fakeApi.agents.map(present)`;
- in the `POST /agents` handler give the new agent `config_version: 1, attached_rules: []`;
- append handlers:

```ts
  http.get(apiPath('/agents/:id'), ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    const agent = fakeApi.agents.find((a) => a.id === params.id)
    return agent ? HttpResponse.json(present(agent)) : detail(404, 'Agent not found')
  }),

  http.patch(apiPath('/agents/:id'), async ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.agentsSupport.update) return methodNotAllowed()
    const index = fakeApi.agents.findIndex((a) => a.id === params.id)
    if (index === -1) return detail(404, 'Agent not found')
    const body = (await request.json()) as AgentUpdate
    fakeApi.lastAgentUpdate = body
    const current = fakeApi.agents[index]
    if (body.name !== undefined && fakeApi.agents.some((a) => a.id !== current.id && a.name === body.name)) {
      return detail(409, 'An agent with this name already exists')
    }
    if (body.upstream_url !== undefined && new URL(body.upstream_url).hostname.includes('unreachable')) {
      return detail(502, 'Upstream agent did not respond successfully')
    }
    const { auth_header, attached_rules, ...fields } = body
    const updated: Agent = {
      ...current,
      ...fields,
      auth_header_name: auth_header === undefined ? current.auth_header_name : (auth_header?.name ?? null),
      attached_rules: attached_rules
        ? attached_rules.map((r, order_index) => ({ ...r, order_index }))
        : current.attached_rules,
      config_version: (current.config_version ?? 1) + 1,
    }
    fakeApi.agents[index] = updated
    return HttpResponse.json(present(updated))
  }),

  http.delete(apiPath('/agents/:id'), ({ request, params }) => {
    if (!signedIn(request)) return notAuthenticated()
    if (!fakeApi.agentsSupport.delete) return methodNotAllowed()
    if (!fakeApi.agents.some((a) => a.id === params.id)) return detail(404, 'Agent not found')
    fakeApi.agents = fakeApi.agents.filter((a) => a.id !== params.id)
    return new HttpResponse(null, { status: 204 })
  }),
```

(`_omit` is unused on purpose; if oxlint flags it, use `delete` on a shallow copy instead.)

- [ ] **Step 6: Overview and page**

Create `apps/web/src/pages/agent/AgentOverview.tsx`:

```tsx
import type { Agent } from '../../api/types'
import { formatLabel } from '../agents/agentDisplay'

const term = 'text-xs font-semibold tracking-[0.04em] text-muted uppercase'
const value = 'm-0 text-sm'

export function AgentOverview({ agent }: { agent: Agent }) {
  return (
    <section aria-label="Overview" className="rounded-xl border border-line bg-surface p-5 sm:p-6">
      <dl className="m-0 grid gap-x-8 gap-y-4 sm:grid-cols-[12rem_1fr]">
        <dt className={term}>Description</dt>
        <dd className={value}>{agent.description || '—'}</dd>
        <dt className={term}>Upstream URL</dt>
        <dd className={`${value} font-mono text-[13px] break-all`}>{agent.upstream_url}</dd>
        <dt className={term}>Formats</dt>
        <dd className={value}>
          {formatLabel(agent.request_format)} → {formatLabel(agent.response_format)}
        </dd>
        <dt className={term}>Auth header</dt>
        <dd className={`${value} ${agent.auth_header_name ? 'font-mono text-[13px]' : 'text-muted'}`}>
          {agent.auth_header_name ?? 'None'}
        </dd>
        <dt className={term}>ID</dt>
        <dd className={`${value} font-mono text-[13px] break-all`}>{agent.id}</dd>
        {agent.config_version !== undefined && (
          <>
            <dt className={term}>Config version</dt>
            <dd className={value}>{agent.config_version}</dd>
          </>
        )}
      </dl>
    </section>
  )
}
```

Create `apps/web/src/pages/agent/AgentPage.tsx`:

```tsx
import { Link, useParams } from 'react-router'
import { useAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import { buttonSecondary } from '../../ui/classes'
import { AgentOverview } from './AgentOverview'

const backLink = 'inline-flex min-h-11 items-center text-sm font-semibold no-underline'

export function AgentPage() {
  const { agentId = '' } = useParams()
  const agent = useAgent(agentId)

  if (agent.isPending) {
    return (
      <section aria-busy="true" className="flex flex-col gap-6">
        <span className="block h-8 w-64 animate-pulse rounded bg-[#ECECE6]" />
        <span className="block h-48 animate-pulse rounded-xl bg-[#ECECE6]" />
      </section>
    )
  }

  if (agent.isError) {
    const notFound = agent.error instanceof ApiError && (agent.error.status === 404 || agent.error.status === 422)
    return notFound ? (
      <section className="flex flex-col items-start gap-4">
        <h1 className="m-0 text-[28px] font-semibold tracking-tight">Agent not found</h1>
        <Link to="/agents" className={backLink}>
          Back to agents
        </Link>
      </section>
    ) : (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load this agent.</span>
        <button type="button" className={buttonSecondary} onClick={() => void agent.refetch()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <Link to="/agents" className={`${backLink} self-start`}>
          ← Agents
        </Link>
        <h1 className="m-0 text-[28px] font-semibold tracking-tight break-words">{agent.data.name}</h1>
      </header>
      <AgentOverview agent={agent.data} />
    </section>
  )
}
```

In `apps/web/src/app/AppRoutes.tsx` import `AgentPage` from `../pages/agent/AgentPage` and replace
`<Placeholder title="Agent" issue="D-03 / D-04" />` with `<AgentPage />`.

- [ ] **Step 7: Run tests**

Run: `cd apps/web && pnpm test`
Expected: PASS — including the D-01 route tests and existing agents/guardrails tests.

- [ ] **Step 8: Lint, build, commit**

Run: `cd apps/web && pnpm lint && pnpm build`
Expected: no errors.

```bash
git add docs/api-contract-agents.md apps/web/src/api apps/web/src/test/fakeApi.ts apps/web/src/app/AppRoutes.tsx apps/web/src/pages/agent
git commit -m "feat(web): agent page with overview; propose agents edit/delete/attach contract

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared agent fields and the edit form

**Files:**
- Create: `apps/web/src/pages/agents/AgentFields.tsx`, `apps/web/src/pages/agent/EditAgentForm.tsx`
- Modify: `apps/web/src/pages/agents/RegisterAgentForm.tsx`, `apps/web/src/pages/agent/AgentPage.tsx`
- Test: `apps/web/src/pages/agent/EditAgentForm.test.tsx`

**Interfaces:**
- Produces: `Field({ id, label, error, children })`, `AgentFieldValues { name; description; upstreamUrl; requestFormat; responseFormat }`, `AgentFields({ idPrefix, values, errors, onChange, nameRef })`, `UNREACHABLE` (all from `AgentFields.tsx`); `EditAgentForm({ agent, onClose })`.
- `RegisterAgentForm` keeps the ids `reg-name`, `reg-upstreamUrl`, `reg-description`, `reg-request-format`, `reg-response-format` (its tests must pass unchanged).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/agent/EditAgentForm.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function openEdit(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}`)
  await user.click(await screen.findByRole('button', { name: 'Edit' }))
  return user
}

const save = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: 'Save changes' }))

describe('Edit agent', () => {
  it('opens with the current values and focus on Name', async () => {
    await openEdit()
    expect(screen.getByLabelText('Name')).toHaveValue('Support Assistant')
    expect(screen.getByLabelText('Name')).toHaveFocus()
    expect(screen.getByLabelText('Upstream URL')).toHaveValue('https://support-agent.acme.example/api/chat')
    expect(screen.getByLabelText('Keep current')).toBeChecked()
  })

  it('sends only the changed fields and shows the result', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Support Bot')
    await user.selectOptions(screen.getByLabelText('Response format'), 'Text')
    await save(user)
    expect(await screen.findByRole('heading', { level: 1, name: 'Support Bot' })).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({ name: 'Support Bot', response_format: 'text' })
    expect(within(screen.getByRole('region', { name: 'Overview' })).getByText('JSON → Text')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus())
  })

  it('closes without a request when nothing changed', async () => {
    const user = await openEdit()
    await save(user)
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('replaces the auth header without showing the old value', async () => {
    const user = await openEdit()
    await user.click(screen.getByLabelText('Replace'))
    expect(screen.getByLabelText('Header name')).toHaveValue('Authorization')
    expect(screen.getByLabelText('Header value')).toHaveValue('')
    expect(screen.getByLabelText('Header value')).toHaveAttribute('type', 'password')
    await user.type(screen.getByLabelText('Header value'), 'Bearer new')
    await save(user)
    await screen.findByRole('region', { name: 'Overview' })
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: { name: 'Authorization', value: 'Bearer new' } })
    expect(screen.queryByText(/Bearer new/)).not.toBeInTheDocument()
  })

  it('removes the auth header', async () => {
    const user = await openEdit()
    await user.click(screen.getByLabelText('Remove'))
    await save(user)
    const overview = await screen.findByRole('region', { name: 'Overview' })
    expect(within(overview).getByText('None')).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: null })
  })

  it('adds an auth header to an agent without one', async () => {
    const user = await openEdit('agent-contracts')
    expect(screen.getByLabelText('None')).toBeChecked()
    expect(screen.queryByLabelText('Keep current')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Add'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.type(screen.getByLabelText('Header name'), 'X-Api-Key')
    await user.type(screen.getByLabelText('Header value'), 'k')
    await save(user)
    await screen.findByRole('region', { name: 'Overview' })
    expect(fakeApi.lastAgentUpdate).toEqual({ auth_header: { name: 'X-Api-Key', value: 'k' } })
  })

  it('shows a duplicate name under Name', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Contract Summarizer')
    await save(user)
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains an unreachable new URL', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Upstream URL'))
    await user.type(screen.getByLabelText('Upstream URL'), 'https://x.unreachable.example/')
    await save(user)
    expect(
      await screen.findByText("Couldn't reach the upstream agent. Check the URL and that it answers GET requests."),
    ).toBeInTheDocument()
  })

  it('validates before calling the API', async () => {
    const user = await openEdit()
    await user.clear(screen.getByLabelText('Name'))
    await user.click(screen.getByLabelText('Replace'))
    await save(user)
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Header value is required')).toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('says editing is not available yet on a 405', async () => {
    fakeApi.agentsSupport.update = false
    const user = await openEdit()
    await user.type(screen.getByLabelText('Description'), ' More.')
    await save(user)
    expect(await screen.findByText("Editing agents isn't available on this API yet.")).toBeInTheDocument()
  })

  it('cancels and returns focus to Edit', async () => {
    const user = await openEdit()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toHaveFocus()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agent/EditAgentForm.test.tsx`
Expected: FAIL — no "Edit" button.

- [ ] **Step 3: Extract the shared fields**

Create `apps/web/src/pages/agents/AgentFields.tsx`:

```tsx
import type { ReactNode, Ref } from 'react'
import type { MessageFormat } from '../../api/types'
import type { AgentFormErrors } from '../../api/validation'
import { inputClass } from '../../ui/classes'

export const UNREACHABLE = "Couldn't reach the upstream agent. Check the URL and that it answers GET requests."

const labelClass = 'text-[13px] font-semibold text-[#30343B]'

export function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="m-0 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

export interface AgentFieldValues {
  name: string
  description: string
  upstreamUrl: string
  requestFormat: MessageFormat
  responseFormat: MessageFormat
}

interface AgentFieldsProps {
  idPrefix: string
  values: AgentFieldValues
  errors: AgentFormErrors
  onChange: (field: keyof AgentFieldValues, value: string) => void
  nameRef?: Ref<HTMLInputElement>
}

/** Name, upstream URL, description and formats — shared by the register and edit forms. */
export function AgentFields({ idPrefix, values, errors, onChange, nameRef }: AgentFieldsProps) {
  const id = (field: string) => `${idPrefix}-${field}`
  const invalid = (field: 'name' | 'description' | 'upstreamUrl') => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `${id(field)}-error` : undefined,
  })
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('name')} label="Name" error={errors.name}>
          <input
            id={id('name')}
            ref={nameRef}
            value={values.name}
            maxLength={100}
            placeholder="e.g. Billing Assistant"
            onChange={(e) => onChange('name', e.target.value)}
            {...invalid('name')}
            className={inputClass}
          />
        </Field>
        <Field id={id('upstreamUrl')} label="Upstream URL" error={errors.upstreamUrl}>
          <input
            id={id('upstreamUrl')}
            type="url"
            value={values.upstreamUrl}
            placeholder="https://"
            onChange={(e) => onChange('upstreamUrl', e.target.value)}
            {...invalid('upstreamUrl')}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <Field id={id('description')} label="Description" error={errors.description}>
        <textarea
          id={id('description')}
          rows={2}
          value={values.description}
          onChange={(e) => onChange('description', e.target.value)}
          {...invalid('description')}
          className={`${inputClass} py-2`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('request-format')} label="Request format">
          <select
            id={id('request-format')}
            value={values.requestFormat}
            onChange={(e) => onChange('requestFormat', e.target.value)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field id={id('response-format')} label="Response format">
          <select
            id={id('response-format')}
            value={values.responseFormat}
            onChange={(e) => onChange('responseFormat', e.target.value)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
      </div>
    </>
  )
}
```

Rewrite `apps/web/src/pages/agents/RegisterAgentForm.tsx` to use it:
- remove its local `UNREACHABLE`, `labelClass`, `Field`; import `AgentFields, Field, UNREACHABLE, type AgentFieldValues` from `./AgentFields`;
- keep the existing `form: AgentForm` state and the two format states, and render:

```tsx
      <AgentFields
        idPrefix="reg"
        values={{
          name: form.name,
          description: form.description,
          upstreamUrl: form.upstreamUrl,
          requestFormat,
          responseFormat,
        }}
        errors={errors}
        nameRef={nameRef}
        onChange={(field: keyof AgentFieldValues, value) => {
          if (field === 'requestFormat') setRequestFormat(value as MessageFormat)
          else if (field === 'responseFormat') setResponseFormat(value as MessageFormat)
          else set(field, value)
        }}
      />
```

in place of the three blocks it replaces (the Name/URL grid, the Description field, the formats grid). The auth-header checkbox block and everything after stay. `Field` is still used by the header name/value inputs.

Run: `cd apps/web && pnpm vitest run src/pages/agents/RegisterAgentForm.test.tsx`
Expected: PASS (unchanged register tests).

- [ ] **Step 4: Edit form**

Create `apps/web/src/pages/agent/EditAgentForm.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useUpdateAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent, AgentUpdate, MessageFormat } from '../../api/types'
import { hasErrors, validateAgentForm, type AgentFormErrors } from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { AgentFields, Field, UNREACHABLE, type AgentFieldValues } from '../agents/AgentFields'

type HeaderMode = 'keep' | 'replace' | 'remove' | 'none' | 'add'

const EDIT_UNAVAILABLE = "Editing agents isn't available on this API yet."
const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'

export function EditAgentForm({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const hasHeader = agent.auth_header_name !== null
  const [values, setValues] = useState<AgentFieldValues>({
    name: agent.name,
    description: agent.description,
    upstreamUrl: agent.upstream_url,
    requestFormat: agent.request_format,
    responseFormat: agent.response_format,
  })
  const [mode, setMode] = useState<HeaderMode>(hasHeader ? 'keep' : 'none')
  const [headerName, setHeaderName] = useState(agent.auth_header_name ?? 'Authorization')
  const [headerValue, setHeaderValue] = useState('')
  const [errors, setErrors] = useState<AgentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const update = useUpdateAgent(agent.id)
  const nameRef = useRef<HTMLInputElement>(null)
  const sendsHeader = mode === 'replace' || mode === 'add'

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const change = (field: keyof AgentFieldValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateAgentForm({
      name: values.name,
      description: values.description,
      upstreamUrl: values.upstreamUrl,
      sendAuthHeader: sendsHeader,
      authHeaderName: headerName,
      authHeaderValue: headerValue,
    })
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return

    const changes: AgentUpdate = {}
    if (values.name.trim() !== agent.name) changes.name = values.name.trim()
    if (values.description !== agent.description) changes.description = values.description
    if (values.upstreamUrl.trim() !== agent.upstream_url) changes.upstream_url = values.upstreamUrl.trim()
    if (values.requestFormat !== agent.request_format) changes.request_format = values.requestFormat
    if (values.responseFormat !== agent.response_format) changes.response_format = values.responseFormat
    if (sendsHeader) changes.auth_header = { name: headerName.trim(), value: headerValue }
    if (mode === 'remove') changes.auth_header = null
    if (Object.keys(changes).length === 0) {
      onClose()
      return
    }

    update.mutate(changes, {
      onSuccess: onClose,
      onError: (error) => {
        if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
        else if (error instanceof ApiError && error.status === 502) setFormError(UNREACHABLE)
        else if (error instanceof ApiError && error.status === 405) setFormError(EDIT_UNAVAILABLE)
        else if (error instanceof ApiError && error.status === 422 && error.field === 'upstream_url') {
          setErrors({ upstreamUrl: error.message })
        } else setFormError(error.message)
      },
    })
  }

  const modes: { id: HeaderMode; label: string }[] = hasHeader
    ? [
        { id: 'keep', label: 'Keep current' },
        { id: 'replace', label: 'Replace' },
        { id: 'remove', label: 'Remove' },
      ]
    : [
        { id: 'none', label: 'None' },
        { id: 'add', label: 'Add' },
      ]

  return (
    <form onSubmit={submit} noValidate aria-labelledby="edit-agent-title" className={card}>
      <h2 id="edit-agent-title" className="m-0 text-lg font-semibold">
        Edit agent
      </h2>

      <AgentFields idPrefix="edit" values={values} errors={errors} onChange={change} nameRef={nameRef} />

      <fieldset className="m-0 flex flex-col gap-3 border-0 p-0">
        <legend className="mb-2 text-[13px] font-semibold text-[#30343B]">Auth header</legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {modes.map((m) => (
            <label key={m.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="radio"
                name="auth-header-mode"
                checked={mode === m.id}
                onChange={() => {
                  setMode(m.id)
                  setErrors((current) => ({ ...current, authHeaderName: undefined, authHeaderValue: undefined }))
                }}
              />
              {m.label}
            </label>
          ))}
        </div>
        {sendsHeader && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="edit-authHeaderName" label="Header name" error={errors.authHeaderName}>
              <input
                id="edit-authHeaderName"
                value={headerName}
                onChange={(e) => setHeaderName(e.target.value)}
                aria-invalid={Boolean(errors.authHeaderName)}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field id="edit-authHeaderValue" label="Header value" error={errors.authHeaderValue}>
              <input
                id="edit-authHeaderValue"
                type="password"
                autoComplete="off"
                value={headerValue}
                onChange={(e) => setHeaderValue(e.target.value)}
                aria-invalid={Boolean(errors.authHeaderValue)}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        )}
      </fieldset>

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={update.isPending}>
          Save changes
        </button>
      </div>
    </form>
  )
}
```

Note: the test for "unchanged form" relies on `MessageFormat` values matching; the import of `MessageFormat` is used by `AgentFieldValues` only — drop it from this file's import if oxlint flags it as unused.

- [ ] **Step 5: Wire Edit into the page**

In `AgentPage.tsx`:
- import `useEffect, useRef, useState` from `react`, `EditAgentForm` from `./EditAgentForm`, and `buttonPrimary` from the classes;
- add state and focus return (inside the component, before the early returns):

```tsx
  const [editing, setEditing] = useState(false)
  const editButtonRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus()
    wasEditing.current = editing
  }, [editing])
```

- in the success render, put the title and actions in a row and swap overview/form:

```tsx
      <header className="flex flex-col gap-2">
        <Link to="/agents" className={`${backLink} self-start`}>
          ← Agents
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight break-words">{agent.data.name}</h1>
          {!editing && (
            <div className="flex flex-wrap gap-2">
              <button ref={editButtonRef} type="button" className={buttonPrimary} onClick={() => setEditing(true)}>
                Edit
              </button>
            </div>
          )}
        </div>
      </header>
      {editing ? (
        <EditAgentForm agent={agent.data} onClose={() => setEditing(false)} />
      ) : (
        <AgentOverview agent={agent.data} />
      )}
```

- [ ] **Step 6: Run tests**

Run: `cd apps/web && pnpm test`
Expected: PASS.

- [ ] **Step 7: Lint, build, commit**

Run: `cd apps/web && pnpm lint && pnpm build`
Expected: no errors.

```bash
git add apps/web/src/pages/agents/AgentFields.tsx apps/web/src/pages/agents/RegisterAgentForm.tsx apps/web/src/pages/agent
git commit -m "feat(web): edit an agent, including replacing or removing its auth header

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Delete

**Files:**
- Modify: `apps/web/src/pages/agent/AgentPage.tsx`
- Test: `apps/web/src/pages/agent/AgentDelete.test.tsx`

**Interfaces:**
- Consumes: `useDeleteAgent` (Task 1).

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/agent/AgentDelete.test.tsx`:

```tsx
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function open() {
  const user = userEvent.setup()
  renderApp('/agents/agent-support')
  await screen.findByRole('heading', { level: 1, name: 'Support Assistant' })
  return user
}

describe('Delete agent', () => {
  it('asks for confirmation, deletes and returns to the list', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/agents'))
    expect(await screen.findByRole('link', { name: 'Contract Summarizer' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Assistant' })).not.toBeInTheDocument()
    expect(screen.queryByText('Agent not found')).not.toBeInTheDocument()
    expect(fakeApi.agents.map((a) => a.id)).toEqual(['agent-contracts'])
  })

  it('cancels when focus moves away', async () => {
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.tab()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(fakeApi.agents).toHaveLength(2)
  })

  it('says deleting is not available yet on a 405', async () => {
    fakeApi.agentsSupport.delete = false
    const user = await open()
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    await user.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(await screen.findByText("Deleting agents isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.getByTestId('location').textContent).toBe('/agents/agent-support')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agent/AgentDelete.test.tsx`
Expected: FAIL — no "Delete" button.

- [ ] **Step 3: Implement**

In `AgentPage.tsx`:
- import `useNavigate` from `react-router`, `useDeleteAgent` from `../../api/agents`;
- add (with the other hooks, before early returns):

```tsx
  const navigate = useNavigate()
  const remove = useDeleteAgent()
  const [confirming, setConfirming] = useState(false)
  useEffect(() => {
    if (!confirming) return
    const timer = setTimeout(() => setConfirming(false), 5000)
    return () => clearTimeout(timer)
  }, [confirming])

  const deleteError =
    remove.error instanceof ApiError && remove.error.status === 405
      ? "Deleting agents isn't available on this API yet."
      : remove.error?.message
```

- in the actions `div`, after Edit:

```tsx
              {confirming ? (
                <button
                  type="button"
                  autoFocus
                  disabled={remove.isPending}
                  onBlur={() => setConfirming(false)}
                  onClick={() => remove.mutate(agent.data.id, { onSuccess: () => navigate('/agents') })}
                  className={`${buttonSecondary} border-danger text-danger`}
                >
                  Confirm delete
                </button>
              ) : (
                <button type="button" className={buttonSecondary} onClick={() => setConfirming(true)}>
                  Delete
                </button>
              )}
```

- below the header row:

```tsx
        {deleteError && (
          <p role="alert" className="m-0 text-sm text-danger">
            {deleteError}
          </p>
        )}
```

- [ ] **Step 4: Run tests, lint, build, commit**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm build`
Expected: all pass.

```bash
git add apps/web/src/pages/agent
git commit -m "feat(web): delete an agent from its page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Attached and mandatory guardrails

**Files:**
- Create: `apps/web/src/pages/agent/AgentGuardrails.tsx`
- Modify: `apps/web/src/pages/agent/AgentPage.tsx`
- Test: `apps/web/src/pages/agent/AgentGuardrails.test.tsx`

**Interfaces:**
- Consumes: `useGuardrails` (`src/api/guardrails.ts`), `useUpdateAgent` (Task 1), `engineLabel`, `stageLabel`, `ACTION_LABELS` (`src/pages/guardrails/guardrailDisplay.ts`), `badgeClass`.
- Produces: `AgentGuardrails({ agent })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/agent/AgentGuardrails.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

const section = () => screen.getByRole('region', { name: 'Guardrails' })
const attachedNames = () =>
  within(within(section()).getByRole('list', { name: 'Attached guardrails' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('[data-name]')?.textContent)

async function open(id = 'agent-support') {
  const user = userEvent.setup()
  renderApp(`/agents/${id}`)
  await within(await screen.findByRole('region', { name: 'Guardrails' })).findByText('PII redaction')
  return user
}

describe('Agent guardrails', () => {
  it('shows mandatory guardrails as always applied, without controls', async () => {
    await open()
    const always = within(section()).getByRole('list', { name: 'Always applied' })
    expect(within(always).getByText('Prompt injection detector')).toBeInTheDocument()
    expect(within(always).queryByRole('button')).not.toBeInTheDocument()
  })

  it('lists attached guardrails in order with their badges', async () => {
    await open()
    expect(attachedNames()).toEqual(['PII redaction'])
    const row = within(section()).getByText('PII redaction').closest('li') as HTMLElement
    expect(within(row).getByText('Open-source library')).toBeInTheDocument()
    expect(within(row).getByText('Redact')).toBeInTheDocument()
  })

  it('never offers mandatory or attached guardrails for attaching', async () => {
    await open()
    const options = within(within(section()).getByLabelText('Attach guardrail'))
      .getAllByRole('option')
      .map((o) => o.textContent)
    expect(options).toEqual(['Choose a guardrail…', 'Toxicity filter'])
  })

  it('attaches, reorders and saves in order', async () => {
    const user = await open()
    await user.selectOptions(within(section()).getByLabelText('Attach guardrail'), 'Toxicity filter')
    await user.click(within(section()).getByRole('button', { name: 'Attach' }))
    expect(attachedNames()).toEqual(['PII redaction', 'Toxicity filter'])
    expect(within(section()).getByText('Unsaved changes')).toBeInTheDocument()
    await user.click(within(section()).getByRole('button', { name: 'Move Toxicity filter up' }))
    expect(attachedNames()).toEqual(['Toxicity filter', 'PII redaction'])
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    await within(section()).findByRole('button', { name: 'Move Toxicity filter down' })
    expect(within(section()).queryByText('Unsaved changes')).not.toBeInTheDocument()
    expect(fakeApi.lastAgentUpdate).toEqual({
      attached_rules: [
        { rule_id: 'gr-toxicity', rule_type: 'guardrail' },
        { rule_id: 'gr-pii', rule_type: 'guardrail' },
      ],
    })
  })

  it('keeps policy rules when saving', async () => {
    fakeApi.agents[0] = {
      ...fakeApi.agents[0],
      attached_rules: [
        { rule_id: 'pol-1', rule_type: 'policy', order_index: 0 },
        { rule_id: 'gr-pii', rule_type: 'guardrail', order_index: 1 },
      ],
    }
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    await within(section()).findByText('No guardrails attached. Only the mandatory ones run.')
    expect(fakeApi.lastAgentUpdate).toEqual({ attached_rules: [{ rule_id: 'pol-1', rule_type: 'policy' }] })
  })

  it('discards local changes', async () => {
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    expect(within(section()).getByText('No guardrails attached. Only the mandatory ones run.')).toBeInTheDocument()
    await user.click(within(section()).getByRole('button', { name: 'Discard' }))
    expect(attachedNames()).toEqual(['PII redaction'])
    expect(fakeApi.lastAgentUpdate).toBeNull()
  })

  it('disables moving past the ends', async () => {
    await open()
    expect(within(section()).getByRole('button', { name: 'Move PII redaction up' })).toBeDisabled()
    expect(within(section()).getByRole('button', { name: 'Move PII redaction down' })).toBeDisabled()
  })

  it('shows unknown guardrail ids so they can be removed', async () => {
    fakeApi.agents[0] = {
      ...fakeApi.agents[0],
      attached_rules: [{ rule_id: 'gr-gone', rule_type: 'guardrail', order_index: 0 }],
    }
    renderApp('/agents/agent-support')
    expect(await screen.findByText('Unknown guardrail (gr-gone)')).toBeInTheDocument()
  })

  it('says attaching is not available when the API has no attached_rules', async () => {
    fakeApi.agentsSupport.attachments = false
    renderApp('/agents/agent-support')
    expect(await screen.findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
    expect(screen.queryByLabelText('Attach guardrail')).not.toBeInTheDocument()
    expect(within(section()).getByRole('list', { name: 'Always applied' })).toBeInTheDocument()
  })

  it('says attaching is not available when saving returns 405', async () => {
    fakeApi.agentsSupport.update = false
    const user = await open()
    await user.click(within(section()).getByRole('button', { name: 'Remove PII redaction' }))
    await user.click(within(section()).getByRole('button', { name: 'Save guardrails' }))
    expect(await within(section()).findByText("Attaching guardrails isn't available on this API yet.")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agent/AgentGuardrails.test.tsx`
Expected: FAIL — no "Guardrails" region.

- [ ] **Step 3: Implement the section**

Create `apps/web/src/pages/agent/AgentGuardrails.tsx`:

```tsx
import { useMemo, useState } from 'react'
import { useUpdateAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import { useGuardrails } from '../../api/guardrails'
import type { Agent, Guardrail } from '../../api/types'
import { badgeClass, buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'
import { ACTION_LABELS, engineLabel, stageLabel } from '../guardrails/guardrailDisplay'

const ATTACH_UNAVAILABLE = "Attaching guardrails isn't available on this API yet."
const small = `${buttonSecondary} px-3 text-xs`
const sub = 'm-0 text-xs font-semibold tracking-[0.04em] text-muted uppercase'

function Badges({ guardrail }: { guardrail: Guardrail }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      <span className={`${badgeClass} bg-[#E6E9F5] text-[#2E3A6B]`}>{engineLabel(guardrail.engine)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{stageLabel(guardrail.stages)}</span>
      <span className={`${badgeClass} bg-[#F0F0EB] text-[#30343B]`}>{ACTION_LABELS[guardrail.action]}</span>
    </span>
  )
}

export function AgentGuardrails({ agent }: { agent: Agent }) {
  const guardrails = useGuardrails()
  const update = useUpdateAgent(agent.id)
  const supported = agent.attached_rules !== undefined
  const rules = useMemo(
    () => [...(agent.attached_rules ?? [])].sort((a, b) => a.order_index - b.order_index),
    [agent.attached_rules],
  )
  const savedIds = useMemo(() => rules.filter((r) => r.rule_type === 'guardrail').map((r) => r.rule_id), [rules])
  const [draft, setDraft] = useState<string[] | null>(null) // null = no local changes
  const [pick, setPick] = useState('')
  const ids = draft ?? savedIds
  const dirty = draft !== null && draft.join('\n') !== savedIds.join('\n')

  const library = guardrails.data ?? []
  const byId = new Map(library.map((g) => [g.id, g]))
  const mandatory = library.filter((g) => g.mandatory)
  const attachable = library.filter((g) => g.enabled && !g.mandatory && !ids.includes(g.id))

  const edit = (next: string[]) => {
    update.reset()
    setDraft(next)
  }
  const move = (index: number, delta: number) => {
    const next = [...ids]
    ;[next[index], next[index + delta]] = [next[index + delta], next[index]]
    edit(next)
  }
  const save = () =>
    update.mutate(
      {
        attached_rules: [
          ...ids.map((rule_id) => ({ rule_id, rule_type: 'guardrail' as const })),
          ...rules.filter((r) => r.rule_type === 'policy').map(({ rule_id, rule_type }) => ({ rule_id, rule_type })),
        ],
      },
      { onSuccess: () => setDraft(null) },
    )

  const saveError =
    update.error instanceof ApiError && update.error.status === 405 ? ATTACH_UNAVAILABLE : update.error?.message

  return (
    <section aria-labelledby="agent-guardrails-title" className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-5 sm:p-6">
      <h2 id="agent-guardrails-title" className="m-0 text-lg font-semibold">
        Guardrails
      </h2>

      {guardrails.isError ? (
        <p role="alert" className="m-0 text-sm">
          Couldn't load guardrails.
        </p>
      ) : guardrails.isPending ? (
        <p className="m-0 text-sm text-muted">Loading guardrails…</p>
      ) : (
        <>
          {mandatory.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 id="always-applied" className={sub}>
                Always applied
              </h3>
              <ul aria-labelledby="always-applied" className="m-0 flex list-none flex-col gap-2 p-0">
                {mandatory.map((g) => (
                  <li key={g.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-canvas px-3 py-2.5">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                    <span className="text-sm font-semibold">{g.name}</span>
                    <Badges guardrail={g} />
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!supported ? (
            <p className="m-0 text-sm text-muted">{ATTACH_UNAVAILABLE}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <h3 id="attached-guardrails" className={sub}>
                Attached guardrails
              </h3>
              {ids.length === 0 ? (
                <p className="m-0 text-sm text-muted">No guardrails attached. Only the mandatory ones run.</p>
              ) : (
                <ol aria-labelledby="attached-guardrails" className="m-0 flex list-none flex-col gap-2 p-0">
                  {ids.map((id, index) => {
                    const g = byId.get(id)
                    const name = g?.name ?? `Unknown guardrail (${id})`
                    return (
                      <li key={id} className="flex flex-wrap items-center gap-3 rounded-lg border border-line px-3 py-2">
                        <span className="w-6 text-sm text-muted">{index + 1}.</span>
                        <span data-name className="text-sm font-semibold">
                          {name}
                        </span>
                        {g && <Badges guardrail={g} />}
                        <span className="ml-auto flex gap-2">
                          <button type="button" className={small} disabled={index === 0} aria-label={`Move ${name} up`} onClick={() => move(index, -1)}>
                            ↑
                          </button>
                          <button
                            type="button"
                            className={small}
                            disabled={index === ids.length - 1}
                            aria-label={`Move ${name} down`}
                            onClick={() => move(index, 1)}
                          >
                            ↓
                          </button>
                          <button type="button" className={small} aria-label={`Remove ${name}`} onClick={() => edit(ids.filter((x) => x !== id))}>
                            Remove
                          </button>
                        </span>
                      </li>
                    )
                  })}
                </ol>
              )}

              <div className="flex flex-wrap items-end gap-2">
                <div className="flex min-w-60 flex-col gap-1.5">
                  <label htmlFor="attach-guardrail" className="text-[13px] font-semibold text-[#30343B]">
                    Attach guardrail
                  </label>
                  <select id="attach-guardrail" value={pick} onChange={(e) => setPick(e.target.value)} className={inputClass}>
                    <option value="">Choose a guardrail…</option>
                    {attachable.map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className={buttonSecondary}
                  disabled={!pick}
                  onClick={() => {
                    edit([...ids, pick])
                    setPick('')
                  }}
                >
                  Attach
                </button>
              </div>

              {(dirty || saveError) && (
                <div className="flex flex-wrap items-center gap-3">
                  {dirty && <span className="text-sm text-warn-fg">Unsaved changes</span>}
                  {saveError && (
                    <span role="alert" className="text-sm text-danger">
                      {saveError}
                    </span>
                  )}
                  <span className="ml-auto flex gap-2">
                    <button
                      type="button"
                      className={buttonSecondary}
                      onClick={() => {
                        setDraft(null)
                        update.reset()
                      }}
                    >
                      Discard
                    </button>
                    <button type="button" className={buttonPrimary} disabled={!dirty || update.isPending} onClick={save}>
                      Save guardrails
                    </button>
                  </span>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
```

In the "keeps policy rules when saving" test the list becomes empty after Remove, so `dirty` is true and the Save button is present; after saving, `draft` resets and the returned agent's rules show the empty state.

- [ ] **Step 4: Mount it**

In `AgentPage.tsx` import `AgentGuardrails` and render `<AgentGuardrails agent={agent.data} />` after the overview/edit block (shown in both modes).

- [ ] **Step 5: Run tests, lint, build, commit**

Run: `cd apps/web && pnpm test && pnpm lint && pnpm build`
Expected: all pass.

```bash
git add apps/web/src/pages/agent
git commit -m "feat(web): attach, reorder and remove an agent's guardrails; show mandatory ones

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Verification

- [ ] **Step 1:** `cd apps/web && pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test` — all pass.
- [ ] **Step 2:** Against production (read-only, as a guest): `GET /api/v1/agents/{id}` through `https://hackyeah-2026-dsc22.vercel.app` for a guest's own agent if one exists, otherwise confirm 404 → "Agent not found" behaviour matches; `PATCH`/`DELETE` returning 405 confirms the "not available yet" states will show. Do not create or modify production data.
