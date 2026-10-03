# Agents Page on Real Data, with Supabase Sign-in — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sign in with Supabase, send the access token to the API, and show and register agents from the real database instead of the MSW mock.

**Architecture:** `src/auth/` wraps Supabase Auth behind a small `AuthClient` interface (real adapter in `supabase.ts`, fake in tests), exposes `AuthProvider`/`useAuth`/`RequireAuth`, and registers a token provider and a 401 handler with `src/api/client.ts`. The agents hooks and screens switch to the real API's shapes; the browser MSW mock is deleted and the test fake API gains agents endpoints that behave like the real ones.

**Tech Stack:** React 19, TypeScript 6, react-router v8, TanStack Query 5, `@supabase/supabase-js` 2, MSW 3 (tests only), Vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-03-agents-real-data-design.md`

## Global Constraints

- pnpm only, inside `apps/web`; TypeScript only; no `any`; relative `/api/...` paths via `client.ts`.
- Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. Missing either → sign-in page shows exactly: "Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local (make supabase writes them)."
- Texts exactly: "Sign in to Guardrail Hub", "Your session expired. Sign in again.", "No agents yet. Register your first one.", "Couldn't load agents.", "Couldn't reach the upstream agent. Check the URL and that it answers GET requests.", "An agent with this name already exists" (from the API).
- Test identities: demo email `demo@guardrail.local`, demo password `demo-password`, token `test-token`.
- Conventional commits ending with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. The first API request after sign-in must already carry the token (child effects run before parent effects) → the token is read from a ref that is updated before the session state changes. Pinned in Task 1 ("sends the token on the first request after signing in").
2. Signing out and back in as someone else must not show the previous user's cached agents → the query cache is cleared on sign-out. Pinned in Task 1.
3. A 401 while signed in must not loop (handler → sign-out → redirect once). Pinned in Task 1.
4. An auth-header 422 (`loc: ["body","auth_header","name"]`) must not be shown as the agent Name error. Pinned in Task 3.
5. The header value must never be echoed back or rendered after registering (API returns only `auth_header_name`). Pinned in Task 3.

---

## File Structure

```
apps/web/
  package.json, pnpm-lock.yaml      + @supabase/supabase-js
  .env.example                      + VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
  .oxlintrc.json                    − mockServiceWorker ignore
  public/mockServiceWorker.js       deleted
  src/
    env.d.ts                        VITE_SUPABASE_* (VITE_API_MOCK removed)
    main.tsx                        no worker; AuthProvider with the real client
    api/client.ts                   + setAccessTokenProvider, setUnauthorizedHandler
    api/types.ts                    agent types replaced by the real API's
    api/validation.ts               validateAgentForm + isHttpUrl
    api/agents.ts                   useAgents (unwrap data), useRegisterAgent
    auth/types.ts                   AuthSession, AuthClient
    auth/supabase.ts                createAuthClient() adapter (null when unconfigured)
    auth/context.ts                 AuthContext, useAuth, SESSION_EXPIRED
    auth/AuthProvider.tsx           session state, token provider, 401 handler
    auth/RequireAuth.tsx            route guard
    pages/SignInPage.tsx            /sign-in
    app/AppRoutes.tsx               /sign-in route; layout behind RequireAuth
    app/Sidebar.tsx                 + signed-in email and Sign out
    pages/agents/agentDisplay.ts    formatLabel only
    pages/agents/AgentsTable.tsx    new columns
    pages/agents/AgentsPage.tsx     no groups
    pages/agents/RegisterAgentForm.tsx  FR-01 fields
    pages/agents/GroupChips.tsx(+test), AgentsPage.focus.test.tsx  deleted
    mocks/                          deleted
    test/fakeAuth.ts                fake AuthClient
    test/fakeApi.ts                 + agents endpoints
    test/server.ts, test/setup.ts   no mocks/; reset client hooks
    test/renderApp.tsx              + AuthProvider (signed in by default)
```

---

### Task 1: Sign-in, session and the token on every request

**Files:**
- Modify: `apps/web/package.json`, `pnpm-lock.yaml` (pnpm), `apps/web/.env.example`, `apps/web/src/env.d.ts`, `apps/web/src/api/client.ts`, `apps/web/src/app/AppRoutes.tsx`, `apps/web/src/app/Sidebar.tsx`, `apps/web/src/app/Sidebar.test.tsx`, `apps/web/src/test/renderApp.tsx`, `apps/web/src/test/setup.ts`, `apps/web/src/main.tsx`
- Create: `apps/web/src/auth/types.ts`, `apps/web/src/auth/supabase.ts`, `apps/web/src/auth/context.ts`, `apps/web/src/auth/AuthProvider.tsx`, `apps/web/src/auth/RequireAuth.tsx`, `apps/web/src/pages/SignInPage.tsx`, `apps/web/src/test/fakeAuth.ts`
- Test: `apps/web/src/auth/auth.test.tsx`, `apps/web/src/api/client.test.ts` (append)

**Interfaces:**
- Produces:
  - `auth/types.ts`: `interface AuthSession { accessToken: string; email: string }`, `interface AuthClient { getSession(): Promise<AuthSession | null>; onAuthStateChange(cb: (s: AuthSession | null) => void): () => void; signIn(email: string, password: string): Promise<string | null>; signOut(): Promise<void> }`
  - `auth/context.ts`: `SESSION_EXPIRED`, `interface AuthState { status: 'loading' | 'ready'; session: AuthSession | null; configured: boolean; signIn(email, password): Promise<string | null>; signOut(): Promise<void> }`, `AuthContext`, `useAuth()`.
  - `AuthProvider({ client, initialSession?, children })`; `RequireAuth({ children })`; `SignInPage()`.
  - `client.ts`: `setAccessTokenProvider(fn: () => string | null)`, `setUnauthorizedHandler(fn: (() => void) | null)`.
  - `test/fakeAuth.ts`: `DEMO_EMAIL`, `DEMO_PASSWORD`, `TEST_TOKEN`, `createFakeAuth({ signedIn }): FakeAuth` where `FakeAuth extends AuthClient` adds `session: AuthSession | null`.
  - `renderApp(path, role?, { signedIn = true } = {})` returns RTL's result plus `auth: FakeAuth`.

- [ ] **Step 1: Dependency and env**

```bash
cd apps/web && pnpm add @supabase/supabase-js
```

Append to `apps/web/.env.example`:

```
# Supabase project for sign-in. `make supabase` writes local values to .env.local.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

Replace `apps/web/src/env.d.ts`:

```ts
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  // Removed in Task 2 together with the browser mock.
  readonly VITE_API_MOCK?: string
}
```

- [ ] **Step 2: Write the failing tests**

Create `apps/web/src/test/fakeAuth.ts`:

```ts
import type { AuthClient, AuthSession } from '../auth/types'

export const DEMO_EMAIL = 'demo@guardrail.local'
export const DEMO_PASSWORD = 'demo-password'
export const TEST_TOKEN = 'test-token'

export interface FakeAuth extends AuthClient {
  session: AuthSession | null
}

export function createFakeAuth({ signedIn = true }: { signedIn?: boolean } = {}): FakeAuth {
  const listeners = new Set<(s: AuthSession | null) => void>()
  const emit = (s: AuthSession | null) => listeners.forEach((cb) => cb(s))
  const fake: FakeAuth = {
    session: signedIn ? { accessToken: TEST_TOKEN, email: DEMO_EMAIL } : null,
    getSession: () => Promise.resolve(fake.session),
    onAuthStateChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    async signIn(email, password) {
      if (email !== DEMO_EMAIL || password !== DEMO_PASSWORD) return 'Invalid login credentials'
      fake.session = { accessToken: TEST_TOKEN, email }
      emit(fake.session)
      return null
    },
    async signOut() {
      fake.session = null
      emit(null)
    },
  }
  return fake
}
```

Replace `apps/web/src/test/renderApp.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '../app/AppRoutes'
import { ROLE_STORAGE_KEY, type Role } from '../app/role'
import { RoleProvider } from '../app/RoleProvider'
import { AuthProvider } from '../auth/AuthProvider'
import { createFakeAuth } from './fakeAuth'

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="location">{location.pathname + location.search}</div>
}

export function renderApp(path: string, role?: Role, { signedIn = true }: { signedIn?: boolean } = {}) {
  if (role) localStorage.setItem(ROLE_STORAGE_KEY, role)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const auth = createFakeAuth({ signedIn })
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider client={auth} initialSession={auth.session}>
          <RoleProvider>
            <AppRoutes />
            <LocationProbe />
          </RoleProvider>
        </AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return { ...result, auth }
}
```

Create `apps/web/src/auth/auth.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../api/client'
import { AppRoutes } from '../app/AppRoutes'
import { RoleProvider } from '../app/RoleProvider'
import { DEMO_EMAIL, DEMO_PASSWORD, TEST_TOKEN } from '../test/fakeAuth'
import { renderApp } from '../test/renderApp'
import { server } from '../test/server'
import { AuthProvider } from './AuthProvider'

const location = () => screen.getByTestId('location').textContent

async function signIn(user: ReturnType<typeof userEvent.setup>, password = DEMO_PASSWORD) {
  await user.type(screen.getByLabelText('Email'), DEMO_EMAIL)
  await user.type(screen.getByLabelText('Password'), password)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('sign-in', () => {
  it('sends signed-out visitors to /sign-in and back after signing in', async () => {
    const user = userEvent.setup()
    renderApp('/guardrails', undefined, { signedIn: false })
    expect(location()).toBe('/sign-in')
    expect(screen.getByRole('heading', { name: 'Sign in to Guardrail Hub' })).toBeInTheDocument()
    await signIn(user)
    await waitFor(() => expect(location()).toBe('/guardrails'))
  })

  it('shows the Supabase error for a wrong password', async () => {
    const user = userEvent.setup()
    renderApp('/fleet', undefined, { signedIn: false })
    await signIn(user, 'nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
    expect(location()).toBe('/sign-in')
  })

  it('sends the token on the first request after signing in', async () => {
    const seen: (string | null)[] = []
    server.use(
      http.get(apiPath('/agents'), ({ request }) => {
        seen.push(request.headers.get('Authorization'))
        return HttpResponse.json({ data: [], total: 0 })
      }),
    )
    const user = userEvent.setup()
    renderApp('/agents', undefined, { signedIn: false })
    await signIn(user)
    await screen.findByText('No agents yet. Register your first one.')
    expect(seen[0]).toBe(`Bearer ${TEST_TOKEN}`)
  })

  it('shows the signed-in email and signs out', async () => {
    const user = userEvent.setup()
    renderApp('/fleet')
    expect(screen.getByText(DEMO_EMAIL)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(location()).toBe('/sign-in'))
  })

  it('signs out once and explains when the API rejects the session', async () => {
    let calls = 0
    server.use(
      http.get(apiPath('/agents'), () => {
        calls += 1
        return HttpResponse.json({ detail: 'Invalid Supabase access token' }, { status: 401 })
      }),
    )
    renderApp('/agents')
    expect(await screen.findByText('Your session expired. Sign in again.')).toBeInTheDocument()
    expect(location()).toBe('/sign-in')
    expect(calls).toBe(1)
  })

  it('redirects signed-in users away from /sign-in', () => {
    renderApp('/sign-in')
    expect(location()).toBe('/fleet')
  })

  it('explains missing Supabase configuration', () => {
    const queryClient = new QueryClient()
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/fleet']}>
          <AuthProvider client={null}>
            <RoleProvider>
              <AppRoutes />
            </RoleProvider>
          </AuthProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    expect(screen.getByText(/Supabase isn't configured/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
  })

  it('clears cached data on sign-out', async () => {
    const user = userEvent.setup()
    const { auth } = renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(location()).toBe('/sign-in'))
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    await signIn(user)
    await waitFor(() => expect(location()).toBe('/agents'))
    expect(auth.session?.email).toBe(DEMO_EMAIL)
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Support Assistant' })).not.toBeInTheDocument()
  })
})
```

Three of these tests need the agents endpoints of the fake API from Task 2; they stay red until then (see Step 6).

Append to the `describe('api client', …)` block in `apps/web/src/api/client.test.ts` (add `setAccessTokenProvider, setUnauthorizedHandler` to the import from `./client`):

```ts
  it('adds the bearer token from the provider', async () => {
    let auth: string | null = null
    server.use(
      http.get(apiPath('/whoami'), ({ request }) => {
        auth = request.headers.get('Authorization')
        return HttpResponse.json({ ok: true })
      }),
    )
    setAccessTokenProvider(() => 'abc')
    await getJson('/whoami')
    expect(auth).toBe('Bearer abc')
  })

  it('calls the unauthorized handler on 401', async () => {
    let called = 0
    server.use(http.get(apiPath('/private'), () => HttpResponse.json({ detail: 'nope' }, { status: 401 })))
    setUnauthorizedHandler(() => {
      called += 1
    })
    await expect(getJson('/private')).rejects.toMatchObject({ status: 401 })
    expect(called).toBe(1)
  })
```

In `apps/web/src/test/setup.ts` import `setAccessTokenProvider, setUnauthorizedHandler` from `../api/client` and, in `afterEach`, add:

```ts
  setAccessTokenProvider(() => null)
  setUnauthorizedHandler(null)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/auth src/api/client.test.ts`
Expected: FAIL — `../auth/AuthProvider` / `setAccessTokenProvider` missing.

- [ ] **Step 4: Implement auth**

Create `apps/web/src/auth/types.ts`:

```ts
// The slice of Supabase Auth the app uses; the real adapter is in supabase.ts, tests use a fake.
export interface AuthSession {
  accessToken: string
  email: string
}

export interface AuthClient {
  getSession(): Promise<AuthSession | null>
  onAuthStateChange(callback: (session: AuthSession | null) => void): () => void
  /** Resolves to an error message, or null on success. */
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}
```

Create `apps/web/src/auth/supabase.ts`:

```ts
import { createClient, type Session } from '@supabase/supabase-js'
import type { AuthClient, AuthSession } from './types'

function toSession(session: Session | null): AuthSession | null {
  return session ? { accessToken: session.access_token, email: session.user.email ?? '' } : null
}

/** Null when VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are not set. */
export function createAuthClient(): AuthClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) return null
  const { auth } = createClient(url, key)
  return {
    async getSession() {
      const { data } = await auth.getSession()
      return toSession(data.session)
    },
    onAuthStateChange(callback) {
      const { data } = auth.onAuthStateChange((_event, session) => callback(toSession(session)))
      return () => data.subscription.unsubscribe()
    },
    async signIn(email, password) {
      const { error } = await auth.signInWithPassword({ email, password })
      return error ? error.message : null
    },
    async signOut() {
      await auth.signOut()
    },
  }
}
```

Create `apps/web/src/auth/context.ts`:

```ts
import { createContext, useContext } from 'react'
import type { AuthSession } from './types'

export const SESSION_EXPIRED = 'Your session expired. Sign in again.'

export interface AuthState {
  status: 'loading' | 'ready'
  session: AuthSession | null
  configured: boolean
  signIn(email: string, password: string): Promise<string | null>
  signOut(): Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
```

Create `apps/web/src/auth/AuthProvider.tsx`:

```tsx
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { setAccessTokenProvider, setUnauthorizedHandler } from '../api/client'
import { AuthContext, SESSION_EXPIRED, type AuthState } from './context'
import type { AuthClient, AuthSession } from './types'

interface AuthProviderProps {
  client: AuthClient | null
  /** Skips the async session lookup (tests). */
  initialSession?: AuthSession | null
  children: ReactNode
}

export function AuthProvider({ client, initialSession, children }: AuthProviderProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [session, setSessionState] = useState<AuthSession | null>(initialSession ?? null)
  const [status, setStatus] = useState<'loading' | 'ready'>(
    !client || initialSession !== undefined ? 'ready' : 'loading',
  )
  // Read at request time; updated before state so a child's first request already has the token.
  const sessionRef = useRef<AuthSession | null>(initialSession ?? null)

  const setSession = useCallback((next: AuthSession | null) => {
    sessionRef.current = next
    setSessionState(next)
  }, [])

  useEffect(() => {
    setAccessTokenProvider(() => sessionRef.current?.accessToken ?? null)
  }, [])

  useEffect(() => {
    if (!client) return
    let active = true
    if (initialSession === undefined) {
      void client.getSession().then((s) => {
        if (!active) return
        setSession(s)
        setStatus('ready')
      })
    }
    const unsubscribe = client.onAuthStateChange(setSession)
    return () => {
      active = false
      unsubscribe()
    }
  }, [client, initialSession, setSession])

  const signOut = useCallback(async () => {
    setSession(null)
    queryClient.clear()
    await client?.signOut()
  }, [client, queryClient, setSession])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (!sessionRef.current) return // already signed out: no loop
      void signOut()
      navigate('/sign-in', { replace: true, state: { notice: SESSION_EXPIRED } })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate, signOut])

  const signIn = useCallback(
    async (email: string, password: string) => {
      if (!client) return 'Supabase is not configured'
      const error = await client.signIn(email, password)
      if (!error) setSession(await client.getSession())
      return error
    },
    [client, setSession],
  )

  const value = useMemo<AuthState>(
    () => ({ status, session, configured: client !== null, signIn, signOut }),
    [status, session, client, signIn, signOut],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
```

Create `apps/web/src/auth/RequireAuth.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from './context'

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, session } = useAuth()
  const location = useLocation()
  if (status === 'loading') return null
  if (!session) {
    return <Navigate to="/sign-in" replace state={{ from: location.pathname + location.search }} />
  }
  return children
}
```

Create `apps/web/src/pages/SignInPage.tsx`:

```tsx
import { useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router'
import { homeFor } from '../app/nav'
import { useRole } from '../app/role'
import { useAuth } from '../auth/context'
import { buttonPrimary, inputClass } from '../ui/classes'

interface SignInState {
  from?: string
  notice?: string
}

const label = 'text-[13px] font-semibold text-[#30343B]'

export function SignInPage() {
  const { session, configured, signIn } = useAuth()
  const { role } = useRole()
  const navigate = useNavigate()
  const state = (useLocation().state ?? {}) as SignInState
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const target = state.from ?? homeFor(role)

  if (session) return <Navigate to={target} replace />

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    const message = await signIn(email.trim(), password)
    setPending(false)
    if (message) setError(message)
    else navigate(target, { replace: true })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-12 text-ink">
      <section
        aria-labelledby="sign-in-title"
        className="flex w-full max-w-sm flex-col gap-5 rounded-xl border border-line bg-surface p-6"
      >
        <h1 id="sign-in-title" className="m-0 text-xl font-semibold">
          Sign in to Guardrail Hub
        </h1>
        {state.notice && <p className="m-0 rounded-lg bg-warn-bg p-3 text-sm text-warn-fg">{state.notice}</p>}
        {!configured ? (
          <p className="m-0 text-sm text-muted">
            Supabase isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in apps/web/.env.local
            (make supabase writes them).
          </p>
        ) : (
          <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sign-in-email" className={label}>
                Email
              </label>
              <input
                id="sign-in-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="sign-in-password" className={label}>
                Password
              </label>
              <input
                id="sign-in-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
              />
            </div>
            {error && (
              <p role="alert" className="m-0 text-sm text-danger">
                {error}
              </p>
            )}
            <button type="submit" className={buttonPrimary} disabled={pending || !email.trim() || !password}>
              Sign in
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
```

- [ ] **Step 5: Client hooks, routes, sidebar, entry point**

In `apps/web/src/api/client.ts`, above `async function request`, add:

```ts
let accessTokenProvider: () => string | null = () => null
let unauthorizedHandler: (() => void) | null = null

/** The auth layer supplies the current Supabase access token. */
export function setAccessTokenProvider(provider: () => string | null): void {
  accessTokenProvider = provider
}

/** Called on any 401 (e.g. an expired session). */
export function setUnauthorizedHandler(handler: (() => void) | null): void {
  unauthorizedHandler = handler
}
```

and in `request`, replace `response = await fetch(url, init)` with:

```ts
    const headers = new Headers(init.headers)
    const token = accessTokenProvider()
    if (token && !headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`)
    response = await fetch(url, { ...init, headers })
```

and right after `const text = await response.text()` / `const data = …`, before `if (!response.ok)`, add:

```ts
  if (response.status === 401) unauthorizedHandler?.()
```

In `apps/web/src/app/AppRoutes.tsx`: import `RequireAuth` and `SignInPage`; change the routes to

```tsx
    <Routes>
      <Route path="/sign-in" element={<SignInPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {/* existing children unchanged */}
      </Route>
    </Routes>
```

In `apps/web/src/app/Sidebar.tsx`: import `useAuth` from `../auth/context`; inside the component `const { session, signOut } = useAuth()`; at the start of the `mt-auto` block (before "Viewing as") render:

```tsx
        {session && (
          <div className="flex flex-col gap-2 border-b border-sidebar-track pb-4">
            <span className="truncate text-xs text-sidebar-subtle" title={session.email}>
              {session.email}
            </span>
            <button
              type="button"
              onClick={() => {
                onNavigate()
                void signOut()
              }}
              className="min-h-11 cursor-pointer rounded-lg border border-sidebar-track bg-transparent px-3 text-left text-sm font-medium text-sidebar-muted hover:bg-sidebar-active hover:text-white"
            >
              Sign out
            </button>
          </div>
        )}
```

In `apps/web/src/app/Sidebar.test.tsx`, wrap the rendered `Sidebar` in `<QueryClientProvider client={new QueryClient()}>` and `<AuthProvider client={createFakeAuth()} initialSession={createFakeAuth().session}>` (inside the `MemoryRouter`, outside `RoleProvider`), importing them.

Replace `apps/web/src/main.tsx` (keeps the mock worker until Task 2 removes it):

```tsx
import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { createQueryClient } from './api/queryClient'
import { AppRoutes } from './app/AppRoutes'
import { RoleProvider } from './app/RoleProvider'
import { AuthProvider } from './auth/AuthProvider'
import { createAuthClient } from './auth/supabase'
import './index.css'

async function enableMocking(): Promise<void> {
  if (import.meta.env.VITE_API_MOCK === 'false') return
  const { worker } = await import('./mocks/browser')
  await worker.start({ onUnhandledFrame: 'bypass', quiet: true })
}

const queryClient = createQueryClient()
const authClient = createAuthClient()

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider client={authClient}>
            <RoleProvider>
              <AppRoutes />
            </RoleProvider>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  )
}

enableMocking()
  .catch((error: unknown) => console.error('Mock API failed to start', error))
  .finally(render)
```

- [ ] **Step 6: Run tests**

Run: `cd apps/web && pnpm test`
Expected: PASS except the agents-dependent auth tests ("sends the token on the first request after signing in", "signs out once…", "clears cached data on sign-out") and the existing agents page tests, which now fail because `/api/v1/agents` returns mock-shaped data (`Agent[]`) — Task 2 fixes them. Everything else (sign-in redirects, wrong password, sign-out, configuration message, client token/401, D-01 shell, guardrails) passes.

- [ ] **Step 7: Lint, build, commit**

Run: `cd apps/web && pnpm lint && pnpm build`
Expected: no errors.

```bash
git add apps/web
git commit -m "feat(web): sign in with Supabase and send the access token to the API

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Agents list from the real API; remove the browser mock

**Files:**
- Modify: `apps/web/src/api/types.ts`, `apps/web/src/api/agents.ts`, `apps/web/src/api/validation.ts`, `apps/web/src/api/validation.test.ts`, `apps/web/src/pages/agents/agentDisplay.ts`, `apps/web/src/pages/agents/agentDisplay.test.ts`, `apps/web/src/pages/agents/AgentsTable.tsx`, `apps/web/src/pages/agents/AgentsPage.tsx`, `apps/web/src/pages/agents/AgentsPage.test.tsx`, `apps/web/src/test/fakeApi.ts`, `apps/web/src/test/server.ts`, `apps/web/src/test/setup.ts`, `apps/web/src/main.tsx`, `apps/web/src/env.d.ts`, `apps/web/.oxlintrc.json`
- Delete: `apps/web/src/mocks/`, `apps/web/public/mockServiceWorker.js`, `apps/web/src/pages/agents/GroupChips.tsx`, `apps/web/src/pages/agents/GroupChips.test.tsx`, `apps/web/src/pages/agents/AgentsPage.focus.test.tsx`, `apps/web/src/pages/agents/RegisterAgentForm.test.tsx` (rewritten in Task 3)

**Interfaces:**
- Produces: `MessageFormat`, `Agent`, `AgentRegistration`, `AgentList` (types); `useAgents(): UseQueryResult<Agent[]>`, `useRegisterAgent()` (mutation `AgentRegistration → Agent`); `formatLabel(f: MessageFormat): string`; `fakeApi.agents`, `fakeApi.lastAgentRegistration`; `AgentsTable({ agents, highlightId })`.
- `RegisterAgentForm` is temporarily not mounted (Task 3 rewrites and mounts it).

- [ ] **Step 1: Write the failing tests**

Replace `apps/web/src/pages/agents/AgentsPage.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { apiPath } from '../../api/client'
import { renderApp } from '../../test/renderApp'
import { server } from '../../test/server'

const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement

describe('AgentsPage', () => {
  it('lists the signed-in user’s agents from the API', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    const support = within(rowOf('Support Assistant'))
    expect(support.getByText('Answers order questions.')).toBeInTheDocument()
    expect(support.getByText('https://support-agent.acme.example/api/chat')).toBeInTheDocument()
    expect(support.getByText('JSON → JSON')).toBeInTheDocument()
    expect(support.getByText('Authorization')).toBeInTheDocument()
    const contracts = within(rowOf('Contract Summarizer'))
    expect(contracts.getByText('—')).toBeInTheDocument()
    expect(contracts.getByText('Text → Text')).toBeInTheDocument()
    expect(contracts.getByText('None')).toBeInTheDocument()
    expect(rowOf('Support Assistant').querySelector('a')).toHaveAttribute('href', '/agents/agent-support')
  })

  it('has no group filter or runtime columns any more', async () => {
    renderApp('/agents')
    await screen.findByRole('link', { name: 'Support Assistant' })
    expect(screen.queryByRole('group', { name: 'Filter by group' })).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Status' })).not.toBeInTheDocument()
  })

  it('shows the empty state', async () => {
    server.use(http.get(apiPath('/agents'), () => HttpResponse.json({ data: [], total: 0 })))
    renderApp('/agents')
    expect(await screen.findByText('No agents yet. Register your first one.')).toBeInTheDocument()
  })

  it('shows an error with a working Retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(apiPath('/agents'), () => HttpResponse.json({ detail: 'Could not read agents' }, { status: 503 }), {
        once: true,
      }),
    )
    renderApp('/agents')
    expect(await screen.findByText("Couldn't load agents.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register agent' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('link', { name: 'Support Assistant' })).toBeInTheDocument()
  })
})
```

Replace `apps/web/src/pages/agents/agentDisplay.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { formatLabel } from './agentDisplay'

describe('formatLabel', () => {
  it('names the message formats', () => {
    expect(formatLabel('json')).toBe('JSON')
    expect(formatLabel('text')).toBe('Text')
  })
})
```

Replace `apps/web/src/api/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isHttpUrl, validateAgentForm, type AgentForm } from './validation'

const valid: AgentForm = {
  name: 'Billing Bot',
  description: '',
  upstreamUrl: 'https://billing.example/chat',
  sendAuthHeader: false,
  authHeaderName: 'Authorization',
  authHeaderValue: '',
}

describe('validateAgentForm', () => {
  it('accepts a valid form', () => {
    expect(validateAgentForm(valid)).toEqual({})
  })

  it('checks name, description and URL limits', () => {
    expect(validateAgentForm({ ...valid, name: '  ' }).name).toBe('Name is required')
    expect(validateAgentForm({ ...valid, name: 'x'.repeat(101) }).name).toBe('Use at most 100 characters')
    expect(validateAgentForm({ ...valid, description: 'x'.repeat(1001) }).description).toBe(
      'Use at most 1,000 characters',
    )
    expect(validateAgentForm({ ...valid, upstreamUrl: '' }).upstreamUrl).toBe('Upstream URL is required')
    expect(validateAgentForm({ ...valid, upstreamUrl: 'ftp://x' }).upstreamUrl).toBe('Enter an http or https URL')
  })

  it('requires header name and value only when sending a header', () => {
    expect(validateAgentForm({ ...valid, authHeaderName: '', authHeaderValue: '' })).toEqual({})
    const errors = validateAgentForm({ ...valid, sendAuthHeader: true, authHeaderName: ' ', authHeaderValue: '' })
    expect(errors).toEqual({ authHeaderName: 'Header name is required', authHeaderValue: 'Header value is required' })
  })
})

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://a.test')).toBe(true)
    expect(isHttpUrl('ws://a.test')).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agents src/api/validation.test.ts`
Expected: FAIL — `formatLabel`, `validateAgentForm` missing; agents page still shows mock data/columns.

- [ ] **Step 3: Types, validation, hooks, display**

In `apps/web/src/api/types.ts`, delete `Group`, `AgentMode`, `AgentBase`, `ProxyAgent`, `RuntimeAgent`, `Agent`, `RegisterAgentInput`, `ConnectionResult` and `ApiErrorBody`, and add at the top:

```ts
// Agents: mirror apps/api/app/api/routes/agents/models.py

export type MessageFormat = 'json' | 'text'

export interface Agent {
  id: string
  name: string
  description: string
  upstream_url: string
  auth_header_name: string | null
  request_format: MessageFormat
  response_format: MessageFormat
}

export interface AgentRegistration {
  name: string
  description: string
  upstream_url: string
  auth_header: { name: string; value: string } | null
  request_format: MessageFormat
  response_format: MessageFormat
}

export interface AgentList {
  data: Agent[]
  total: number
}
```

Replace `apps/web/src/api/validation.ts`:

```ts
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export interface AgentForm {
  name: string
  description: string
  upstreamUrl: string
  sendAuthHeader: boolean
  authHeaderName: string
  authHeaderValue: string
}

export type AgentFormField = 'name' | 'description' | 'upstreamUrl' | 'authHeaderName' | 'authHeaderValue'
export type AgentFormErrors = Partial<Record<AgentFormField, string>>

/** Same limits as apps/api AgentRegistration. */
export function validateAgentForm(form: AgentForm): AgentFormErrors {
  const errors: AgentFormErrors = {}
  const name = form.name.trim()
  if (!name) errors.name = 'Name is required'
  else if (name.length > 100) errors.name = 'Use at most 100 characters'
  if (form.description.length > 1000) errors.description = 'Use at most 1,000 characters'
  const url = form.upstreamUrl.trim()
  if (!url) errors.upstreamUrl = 'Upstream URL is required'
  else if (!isHttpUrl(url)) errors.upstreamUrl = 'Enter an http or https URL'
  if (form.sendAuthHeader) {
    if (!form.authHeaderName.trim()) errors.authHeaderName = 'Header name is required'
    if (!form.authHeaderValue) errors.authHeaderValue = 'Header value is required'
  }
  return errors
}

export function hasErrors(errors: AgentFormErrors): boolean {
  return Object.values(errors).some(Boolean)
}
```

Replace `apps/web/src/api/agents.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getJson, postJson } from './client'
import type { Agent, AgentList, AgentRegistration } from './types'

export const agentKeys = { agents: ['agents'] as const }

export function useAgents() {
  return useQuery({
    queryKey: agentKeys.agents,
    queryFn: async () => (await getJson<AgentList>('/agents')).data,
  })
}

export function useRegisterAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (registration: AgentRegistration) => postJson<Agent>('/agents', registration),
    onSuccess: (agent) => {
      // The API lists newest first.
      queryClient.setQueryData<Agent[]>(agentKeys.agents, (old) => [agent, ...(old ?? [])])
      void queryClient.invalidateQueries({ queryKey: agentKeys.agents })
    },
  })
}
```

Replace `apps/web/src/pages/agents/agentDisplay.ts`:

```ts
import type { MessageFormat } from '../../api/types'

export function formatLabel(format: MessageFormat): string {
  return format === 'json' ? 'JSON' : 'Text'
}
```

- [ ] **Step 4: Table and page**

Replace `apps/web/src/pages/agents/AgentsTable.tsx`:

```tsx
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import type { Agent } from '../../api/types'
import { formatLabel } from './agentDisplay'

const HEADERS = ['Agent', 'Description', 'Endpoint', 'Formats', 'Auth header']
const cell = 'px-4 py-3 align-middle'

function TableFrame({ children, busy = false }: { children: ReactNode; busy?: boolean }) {
  return (
    <div
      role="region"
      aria-label="Agents table"
      aria-busy={busy}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border border-line bg-surface"
    >
      <table className="w-full min-w-[880px] border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-line text-xs tracking-[0.04em] text-muted uppercase">
            {HEADERS.map((header) => (
              <th key={header} scope="col" className="px-4 py-3 font-semibold">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function AgentsTable({ agents, highlightId }: { agents: readonly Agent[]; highlightId: string | null }) {
  return (
    <TableFrame>
      {agents.map((agent) => {
        const highlighted = agent.id === highlightId
        return (
          <tr
            key={agent.id}
            data-highlight={highlighted}
            className={`border-b border-line transition-colors last:border-b-0 ${highlighted ? 'bg-teal-soft' : ''}`}
          >
            <td className={cell}>
              <Link to={`/agents/${agent.id}`} className="font-semibold">
                {agent.name}
              </Link>
            </td>
            <td className={`${cell} max-w-72 text-muted`}>{agent.description || '—'}</td>
            <td className={`${cell} font-mono text-[13px] break-all text-muted`}>{agent.upstream_url}</td>
            <td className={`${cell} whitespace-nowrap`}>
              {formatLabel(agent.request_format)} → {formatLabel(agent.response_format)}
            </td>
            <td className={`${cell} ${agent.auth_header_name ? 'font-mono text-[13px]' : 'text-muted'}`}>
              {agent.auth_header_name ?? 'None'}
            </td>
          </tr>
        )
      })}
    </TableFrame>
  )
}

export function AgentsTableSkeleton() {
  return (
    <TableFrame busy>
      {[0, 1, 2, 3].map((row) => (
        <tr key={row} className="border-b border-line last:border-b-0">
          {HEADERS.map((header) => (
            <td key={header} className={cell}>
              <span className="block h-3.5 w-3/4 animate-pulse rounded bg-[#ECECE6]" />
            </td>
          ))}
        </tr>
      ))}
    </TableFrame>
  )
}
```

Replace `apps/web/src/pages/agents/AgentsPage.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { useAgents } from '../../api/agents'
import { buttonPrimary, buttonSecondary } from '../../ui/classes'
import { AgentsTable, AgentsTableSkeleton } from './AgentsTable'

export function AgentsPage() {
  const agents = useAgents()
  const [registering, setRegistering] = useState(false)
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const registerButtonRef = useRef<HTMLButtonElement>(null)
  const wasRegistering = useRef(false)

  // Give focus back to "Register agent" when the form closes (Cancel or success).
  useEffect(() => {
    if (wasRegistering.current && !registering) registerButtonRef.current?.focus()
    wasRegistering.current = registering
  }, [registering])

  useEffect(() => {
    if (!highlightId) return
    const timer = setTimeout(() => setHighlightId(null), 3000)
    return () => clearTimeout(timer)
  }, [highlightId])

  let content
  if (agents.isError) {
    content = (
      <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-6">
        <span className="text-sm">Couldn't load agents.</span>
        <button type="button" className={buttonSecondary} onClick={() => void agents.refetch()}>
          Retry
        </button>
      </div>
    )
  } else if (agents.isPending) {
    content = <AgentsTableSkeleton />
  } else if (agents.data.length === 0) {
    content = (
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        No agents yet. Register your first one.
      </div>
    )
  } else {
    content = <AgentsTable agents={agents.data} highlightId={highlightId} />
  }

  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-1.5">
          <h1 className="m-0 text-[28px] font-semibold tracking-tight">Agents</h1>
          <p className="m-0 text-[15px] text-muted">
            Proxy agents sit behind a guarded URL. Register one by its upstream URL; the hub checks it answers
            before saving.
          </p>
        </div>
        {agents.isSuccess && !registering && (
          <button
            ref={registerButtonRef}
            type="button"
            className={buttonPrimary}
            onClick={() => setRegistering(true)}
          >
            Register agent
          </button>
        )}
      </header>
      {content}
    </section>
  )
}
```

(`setHighlightId` is used by the effect; Task 3 mounts the form and calls it.)

- [ ] **Step 5: Fake API agents, remove the mock**

In `apps/web/src/test/fakeApi.ts`:
- import `Agent, AgentRegistration` from `../api/types` and `TEST_TOKEN` from `./fakeAuth`;
- add to the state object: `agents: Agent[]`, `lastAgentRegistration: AgentRegistration | null`, and an `agentId: number` counter; reset them in `resetFakeApi()` (`agents: seedAgents()`, `lastAgentRegistration: null`, `agentId: 1`);
- add:

```ts
function seedAgents(): Agent[] {
  return [
    {
      id: 'agent-support',
      name: 'Support Assistant',
      description: 'Answers order questions.',
      upstream_url: 'https://support-agent.acme.example/api/chat',
      auth_header_name: 'Authorization',
      request_format: 'json',
      response_format: 'json',
    },
    {
      id: 'agent-contracts',
      name: 'Contract Summarizer',
      description: '',
      upstream_url: 'https://legal-ai.acme.example/summarize',
      auth_header_name: null,
      request_format: 'text',
      response_format: 'text',
    },
  ]
}

const signedIn = (request: Request) => request.headers.get('Authorization') === `Bearer ${TEST_TOKEN}`
const notAuthenticated = () => detail(401, 'Not authenticated')
```

- append these handlers to `fakeApiHandlers`:

```ts
  http.get(apiPath('/agents'), ({ request }) => {
    if (!signedIn(request)) return notAuthenticated()
    return HttpResponse.json({ data: fakeApi.agents, total: fakeApi.agents.length })
  }),

  http.post(apiPath('/agents'), async ({ request }) => {
    if (!signedIn(request)) return notAuthenticated()
    const body = (await request.json()) as AgentRegistration
    fakeApi.lastAgentRegistration = body
    if (!body.name?.trim() || body.name.length > 100) {
      return validation('String should have at most 100 characters', ['body', 'name'])
    }
    if (!/^https?:\/\//.test(body.upstream_url ?? '')) {
      return validation('Input should be a valid URL', ['body', 'upstream_url'])
    }
    if (body.auth_header && !/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(body.auth_header.name)) {
      return validation('auth header name is not a valid HTTP header name', ['body', 'auth_header', 'name'])
    }
    if (fakeApi.agents.some((a) => a.name === body.name)) return detail(409, 'An agent with this name already exists')
    if (new URL(body.upstream_url).hostname.includes('unreachable')) {
      return detail(502, 'Upstream agent did not respond successfully')
    }
    const agent: Agent = {
      id: `agent-new-${fakeApi.agentId++}`,
      name: body.name,
      description: body.description,
      upstream_url: body.upstream_url,
      auth_header_name: body.auth_header?.name ?? null,
      request_format: body.request_format,
      response_format: body.response_format,
    }
    fakeApi.agents.unshift(agent)
    return HttpResponse.json(agent, { status: 201 })
  }),
```

Replace `apps/web/src/test/server.ts`:

```ts
import { setupServer } from 'msw/node'
import { fakeApiHandlers } from './fakeApi'

// Stand-in for the real API (apps/api) in tests.
export const server = setupServer(...fakeApiHandlers)
```

In `apps/web/src/test/setup.ts`, remove the `resetDb` import and call.

Delete the browser mock and the replaced agent files:

```bash
cd apps/web
git rm -rq src/mocks public/mockServiceWorker.js src/pages/agents/GroupChips.tsx src/pages/agents/GroupChips.test.tsx src/pages/agents/AgentsPage.focus.test.tsx src/pages/agents/RegisterAgentForm.test.tsx
```

`RegisterAgentForm.tsx` still imports removed types; replace it with a stub that Task 3 rewrites:

```tsx
// Rewritten in the next task for the real agents API.
export function RegisterAgentForm() {
  return null
}
```

In `apps/web/src/main.tsx`, delete `enableMocking` and render directly:

```tsx
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider client={authClient}>
          <RoleProvider>
            <AppRoutes />
          </RoleProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
```

(remove the `render` function wrapper and the `enableMocking()` chain). Drop `VITE_API_MOCK` from `src/env.d.ts`. Remove the `"ignorePatterns"` entry for `public/mockServiceWorker.js` from `.oxlintrc.json`.

- [ ] **Step 6: Run tests**

Run: `cd apps/web && pnpm test`
Expected: PASS — all suites, including the three agents-dependent auth tests from Task 1.

- [ ] **Step 7: Lint, build, commit**

Run: `cd apps/web && pnpm lint && pnpm build`
Expected: no errors; `dist/` contains no `mockServiceWorker.js`.

```bash
git add -A apps/web
git commit -m "feat(web): list agents from the real API and drop the browser mock

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Register form for the real API (FR-01 fields)

**Files:**
- Modify: `apps/web/src/pages/agents/RegisterAgentForm.tsx` (replace the stub), `apps/web/src/pages/agents/AgentsPage.tsx`
- Test: `apps/web/src/pages/agents/RegisterAgentForm.test.tsx`

**Interfaces:**
- Consumes: `useRegisterAgent`, `ApiError`, `validateAgentForm`, `hasErrors`, `AgentForm`, `AgentFormErrors`, `MessageFormat`, class strings.
- Produces: `RegisterAgentForm({ onClose, onRegistered }: { onClose: () => void; onRegistered: (agent: Agent) => void })`.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/pages/agents/RegisterAgentForm.test.tsx`:

```tsx
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { fakeApi } from '../../test/fakeApi'
import { renderApp } from '../../test/renderApp'

async function openForm() {
  const user = userEvent.setup()
  renderApp('/agents')
  await user.click(await screen.findByRole('button', { name: 'Register agent' }))
  return user
}

async function fill(user: ReturnType<typeof userEvent.setup>, name: string, url: string) {
  await user.type(screen.getByLabelText('Name'), name)
  await user.type(screen.getByLabelText('Upstream URL'), url)
}

describe('Register agent', () => {
  it('moves focus to Name when it opens', async () => {
    await openForm()
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })

  it('registers an agent, closes, highlights the row and returns focus', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    await user.type(screen.getByLabelText('Description'), 'Answers invoices')
    await user.selectOptions(screen.getByLabelText('Response format'), 'Text')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(row).toHaveAttribute('data-highlight', 'true')
    expect(within(row).getByText('JSON → Text')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus())
    expect(fakeApi.lastAgentRegistration).toEqual({
      name: 'Billing Bot',
      description: 'Answers invoices',
      upstream_url: 'https://billing.example/chat',
      auth_header: null,
      request_format: 'json',
      response_format: 'text',
    })
  })

  it('sends an auth header when asked, without showing its value afterwards', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    expect(screen.queryByLabelText('Header value')).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Send an auth header'))
    expect(screen.getByLabelText('Header name')).toHaveValue('Authorization')
    expect(screen.getByLabelText('Header value')).toHaveAttribute('type', 'password')
    await user.type(screen.getByLabelText('Header value'), 'Bearer s3cret')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    const row = (await screen.findByRole('link', { name: 'Billing Bot' })).closest('tr') as HTMLElement
    expect(within(row).getByText('Authorization')).toBeInTheDocument()
    expect(screen.queryByText(/s3cret/)).not.toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration?.auth_header).toEqual({ name: 'Authorization', value: 'Bearer s3cret' })
  })

  it('checks fields before calling the API', async () => {
    const user = await openForm()
    await user.click(screen.getByLabelText('Send an auth header'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.getByText('Upstream URL is required')).toBeInTheDocument()
    expect(screen.getByText('Header name is required')).toBeInTheDocument()
    expect(screen.getByText('Header value is required')).toBeInTheDocument()
    expect(fakeApi.lastAgentRegistration).toBeNull()
  })

  it('shows a duplicate name under Name', async () => {
    const user = await openForm()
    await fill(user, 'Support Assistant', 'https://billing.example/chat')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('An agent with this name already exists')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true')
  })

  it('explains an unreachable upstream', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.unreachable.example/chat')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(
      await screen.findByText("Couldn't reach the upstream agent. Check the URL and that it answers GET requests."),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('does not report an auth-header error as a Name error', async () => {
    const user = await openForm()
    await fill(user, 'Billing Bot', 'https://billing.example/chat')
    await user.click(screen.getByLabelText('Send an auth header'))
    await user.clear(screen.getByLabelText('Header name'))
    await user.type(screen.getByLabelText('Header name'), 'Bad Header')
    await user.type(screen.getByLabelText('Header value'), 'x')
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(await screen.findByText('auth header name is not a valid HTTP header name')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'false')
  })

  it('closes on Cancel and returns focus', async () => {
    const user = await openForm()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Register agent' })).toHaveFocus()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && pnpm vitest run src/pages/agents/RegisterAgentForm.test.tsx`
Expected: FAIL — no "Name" field (the form is a stub and not mounted).

- [ ] **Step 3: Implement the form**

Replace `apps/web/src/pages/agents/RegisterAgentForm.tsx`:

```tsx
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { useRegisterAgent } from '../../api/agents'
import { ApiError } from '../../api/client'
import type { Agent, MessageFormat } from '../../api/types'
import {
  hasErrors,
  validateAgentForm,
  type AgentForm,
  type AgentFormErrors,
  type AgentFormField,
} from '../../api/validation'
import { buttonPrimary, buttonSecondary, inputClass } from '../../ui/classes'

interface RegisterAgentFormProps {
  onClose: () => void
  onRegistered: (agent: Agent) => void
}

const UNREACHABLE = "Couldn't reach the upstream agent. Check the URL and that it answers GET requests."
const card = 'flex flex-col gap-5 rounded-xl border border-line bg-surface p-5 sm:p-6'
const labelClass = 'text-[13px] font-semibold text-[#30343B]'

function Field({ id, label, error, children }: { id: string; label: string; error?: string; children: ReactNode }) {
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

export function RegisterAgentForm({ onClose, onRegistered }: RegisterAgentFormProps) {
  const [form, setForm] = useState<AgentForm>({
    name: '',
    description: '',
    upstreamUrl: '',
    sendAuthHeader: false,
    authHeaderName: 'Authorization',
    authHeaderValue: '',
  })
  const [requestFormat, setRequestFormat] = useState<MessageFormat>('json')
  const [responseFormat, setResponseFormat] = useState<MessageFormat>('json')
  const [errors, setErrors] = useState<AgentFormErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const register = useRegisterAgent()
  const nameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nameRef.current?.focus()
  }, [])

  const set = (field: AgentFormField, value: string) => {
    setForm((current) => ({ ...current, [field]: value }))
    setErrors((current) => ({ ...current, [field]: undefined }))
    setFormError(null)
  }

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const found = validateAgentForm(form)
    setErrors(found)
    setFormError(null)
    if (hasErrors(found)) return
    register.mutate(
      {
        name: form.name.trim(),
        description: form.description,
        upstream_url: form.upstreamUrl.trim(),
        auth_header: form.sendAuthHeader
          ? { name: form.authHeaderName.trim(), value: form.authHeaderValue }
          : null,
        request_format: requestFormat,
        response_format: responseFormat,
      },
      {
        onSuccess: (agent) => {
          onRegistered(agent)
          onClose()
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) setErrors({ name: error.message })
          else if (error instanceof ApiError && error.status === 502) setFormError(UNREACHABLE)
          else if (error instanceof ApiError && error.status === 422 && error.field === 'upstream_url') {
            setErrors({ upstreamUrl: error.message })
          } else setFormError(error.message) // includes auth_header.* 422s: never shown as a Name error
        },
      },
    )
  }

  const invalid = (field: AgentFormField) => ({
    'aria-invalid': Boolean(errors[field]),
    'aria-describedby': errors[field] ? `reg-${field}-error` : undefined,
  })

  return (
    <form onSubmit={submit} noValidate aria-labelledby="register-title" className={card}>
      <h2 id="register-title" className="m-0 text-lg font-semibold">
        Register an agent
      </h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-name" label="Name" error={errors.name}>
          <input
            id="reg-name"
            ref={nameRef}
            value={form.name}
            maxLength={100}
            placeholder="e.g. Billing Assistant"
            onChange={(e) => set('name', e.target.value)}
            {...invalid('name')}
            className={inputClass}
          />
        </Field>
        <Field id="reg-upstreamUrl" label="Upstream URL" error={errors.upstreamUrl}>
          <input
            id="reg-upstreamUrl"
            type="url"
            value={form.upstreamUrl}
            placeholder="https://"
            onChange={(e) => set('upstreamUrl', e.target.value)}
            {...invalid('upstreamUrl')}
            className={`${inputClass} font-mono`}
          />
        </Field>
      </div>

      <Field id="reg-description" label="Description" error={errors.description}>
        <textarea
          id="reg-description"
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          {...invalid('description')}
          className={`${inputClass} py-2`}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reg-request-format" label="Request format">
          <select
            id="reg-request-format"
            value={requestFormat}
            onChange={(e) => setRequestFormat(e.target.value as MessageFormat)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
        <Field id="reg-response-format" label="Response format">
          <select
            id="reg-response-format"
            value={responseFormat}
            onChange={(e) => setResponseFormat(e.target.value as MessageFormat)}
            className={inputClass}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
          </select>
        </Field>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.sendAuthHeader}
            onChange={(e) => {
              setForm((current) => ({ ...current, sendAuthHeader: e.target.checked }))
              setErrors((current) => ({ ...current, authHeaderName: undefined, authHeaderValue: undefined }))
            }}
          />
          Send an auth header
        </label>
        {form.sendAuthHeader && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="reg-authHeaderName" label="Header name" error={errors.authHeaderName}>
              <input
                id="reg-authHeaderName"
                value={form.authHeaderName}
                onChange={(e) => set('authHeaderName', e.target.value)}
                {...invalid('authHeaderName')}
                className={`${inputClass} font-mono`}
              />
            </Field>
            <Field id="reg-authHeaderValue" label="Header value" error={errors.authHeaderValue}>
              <input
                id="reg-authHeaderValue"
                type="password"
                autoComplete="off"
                value={form.authHeaderValue}
                onChange={(e) => set('authHeaderValue', e.target.value)}
                {...invalid('authHeaderValue')}
                className={`${inputClass} font-mono`}
              />
            </Field>
          </div>
        )}
      </div>

      {formError && (
        <p role="alert" className="m-0 text-sm text-danger">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={buttonPrimary} disabled={register.isPending}>
          {register.isPending ? 'Checking upstream…' : 'Register'}
        </button>
      </div>
    </form>
  )
}
```

Note: the submit button's accessible name changes to "Checking upstream…" while pending; tests click it before that state.

- [ ] **Step 4: Mount the form**

In `apps/web/src/pages/agents/AgentsPage.tsx`, import `RegisterAgentForm` and render it between the header and `{content}`:

```tsx
      {registering && (
        <RegisterAgentForm onClose={() => setRegistering(false)} onRegistered={(agent) => setHighlightId(agent.id)} />
      )}
```

- [ ] **Step 5: Run tests**

Run: `cd apps/web && pnpm test`
Expected: PASS.

- [ ] **Step 6: Lint, build, commit**

Run: `cd apps/web && pnpm lint && pnpm build`
Expected: no errors.

```bash
git add apps/web/src/pages/agents
git commit -m "feat(web): register agents with the real API's fields

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Verification against local Supabase

- [ ] **Step 1: Checks**

```bash
uvx ruff@0.16.10 check . && uvx ruff@0.16.10 format --check .
cd apps/web && pnpm install --frozen-lockfile && pnpm lint && pnpm build && pnpm test
```

Expected: all pass.

- [ ] **Step 2: Browser**

With `make supabase` running, start `make api` and `make web`, open `http://localhost:5173/agents`:

- Redirected to `/sign-in`; wrong password shows Supabase's "Invalid login credentials"; signing in as `demo@guardrail.local` (password in `apps/api/supabase/.env.demo`) returns to `/agents`.
- The table lists the database's agents (e.g. "Example Agent" from the setup smoke test); requests carry `Authorization: Bearer …` (network panel).
- Register `https://example.com/` → new highlighted row; register the same name → "An agent with this name already exists" under Name; `https://this-host-does-not-exist.invalid/` → 422/502 message shown.
- Reload keeps the session; Sign out returns to `/sign-in`.

Expected: all hold; fix anything that does not with a failing test first.
