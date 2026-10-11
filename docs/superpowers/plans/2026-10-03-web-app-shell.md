# Web App Shell (D-01, layout only) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Vite starter in `apps/web` with the AgentsOnRails.dev control-panel shell (sidebar, routes, role switcher, phone drawer) from the prototype.

**Architecture:** One route table (`app/nav.ts`) drives both the sidebar nav and `<Routes>`. A `RoleContext` holds the viewing role (persisted in `localStorage`); `AppRoutes` only registers the routes the current role may see and redirects everything else to that role's home. `Layout` owns the phone drawer state and renders `Sidebar` + `<Outlet/>`. Every page is a `Placeholder` naming the issue that will fill it.

**Tech Stack:** React 19, TypeScript 6, Vite 8, react-router v7 (library mode), Tailwind CSS v4 (`@tailwindcss/vite`), Vitest + Testing Library + jsdom, oxlint.

**Spec:** `docs/superpowers/specs/2026-10-03-web-app-shell-design.md`

## Global Constraints

- pnpm only. `pnpm` is not on PATH here: use `npx -y pnpm@12.8.1` (the version pinned in `package.json` / `vercel.json`). Below, `PNPM` means `npx -y pnpm@12.8.1`. Run it inside `apps/web`.
- After any `package.json` change, `pnpm-lock.yaml` must be updated (CI uses `--frozen-lockfile`).
- TypeScript only (`.ts`/`.tsx`); no `any`.
- No API calls, no API client, no mock server in this plan (deferred until T-02 / #29).
- Role storage key: `gh.role`. Default role: `admin`. Roles: `admin` "Admin", `dev` "Developer", `tester` "Tester".
- Tester home `/test`; everyone else's home `/fleet`.
- Nav items and buttons are at least 44px tall (`min-h-11`).
- Phone breakpoint: below 768px (Tailwind `md`) the sidebar becomes a drawer.
- Light theme only.
- Conventional commits; end each commit message with
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. `localStorage` throws (private mode, blocked storage) → app still renders as Admin and role switching still works in memory. Pinned in Task 2.
2. A stored role that is not a valid role (e.g. `"superuser"`, stale value) → falls back to Admin. Pinned in Task 2.
3. A tester opening a deep link like `/agents/support-bot` or `/policies` → lands on `/test`, never sees another screen. Pinned in Task 3.
4. Agent detail route `/agents/:agentId` → "Agents" stays highlighted in the nav (`aria-current="page"`). Pinned in Task 3.
5. Phone drawer left open after navigating or switching role → must close on nav click, role change, Esc and backdrop click. Pinned in Task 4.

---

## File Structure

```
apps/web/
  index.html                 title + IBM Plex fonts
  vite.config.ts             + tailwind plugin, + vitest config
  package.json               + deps, + "test" script
  src/
    main.tsx                 BrowserRouter > RoleProvider > AppRoutes
    index.css                Tailwind import, @theme tokens, base styles
    app/
      role.ts                Role type, ROLES, storage helpers, RoleContext, useRole
      RoleProvider.tsx       RoleProvider component
      nav.ts                 NAV_ITEMS, homeFor(), navItemsFor()
      AppRoutes.tsx          role-aware <Routes>
      Layout.tsx             phone top bar, drawer state, backdrop, <Outlet/>
      Sidebar.tsx            brand, nav links, role switcher, role note
      Brand.tsx              logo + name
    pages/
      Placeholder.tsx        page title + "Coming in <issue>."
    test/
      setup.ts               jest-dom matchers, cleanup, localStorage reset
      renderApp.tsx          renders the app at a path, exposes current location
.github/workflows/ci.yml     + pnpm test step
```

`role.ts` and `RoleProvider.tsx` are split (the spec says `role.tsx`) so that oxlint's `react/only-export-components` rule stays clean: non-component exports live in `.ts` files.

Deleted: `src/App.tsx`, `src/App.css`, `src/assets/` (hero.png, react.svg, vite.svg), `public/icons.svg`.

---

### Task 1: Tooling, tokens, and the Placeholder page

**Files:**
- Modify: `apps/web/package.json`, `apps/web/pnpm-lock.yaml` (via pnpm), `apps/web/vite.config.ts`, `apps/web/index.html`, `apps/web/src/index.css`, `apps/web/src/main.tsx`, `.github/workflows/ci.yml`
- Create: `apps/web/src/test/setup.ts`, `apps/web/src/pages/Placeholder.tsx`
- Test: `apps/web/src/pages/Placeholder.test.tsx`
- Delete: `apps/web/src/App.tsx`, `apps/web/src/App.css`, `apps/web/src/assets/`, `apps/web/public/icons.svg`

**Interfaces:**
- Produces: `Placeholder({ title, issue }: { title: string; issue: string })` from `src/pages/Placeholder.tsx`; Tailwind color utilities `ink, sidebar, sidebar-active, sidebar-muted, sidebar-subtle, sidebar-track, canvas, surface, line, line-strong, muted, teal, teal-dark, teal-soft, teal-bright, amber, warn-bg, warn-fg, danger`; `pnpm test` script.

- [ ] **Step 1: Install dependencies**

```bash
cd apps/web
npx -y pnpm@12.8.1 add react-router
npx -y pnpm@12.8.1 add -D tailwindcss @tailwindcss/vite vitest jsdom @testing-library/react @testing-library/dom @testing-library/user-event @testing-library/jest-dom
```

Then add the test script to `package.json` `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 2: Configure Vite + Vitest**

Replace `apps/web/vite.config.ts`:

```ts
/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { proxy: { '/api': 'http://localhost:8000' } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
})
```

Create `apps/web/src/test/setup.ts`:

```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})
```

- [ ] **Step 3: Write the failing test**

Create `apps/web/src/pages/Placeholder.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Placeholder } from './Placeholder'

describe('Placeholder', () => {
  it('shows the page title and the issue that will fill it', () => {
    render(<Placeholder title="Fleet" issue="D-06" />)
    expect(screen.getByRole('heading', { level: 1, name: 'Fleet' })).toBeInTheDocument()
    expect(screen.getByText('Coming in D-06.')).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: FAIL — cannot resolve `./Placeholder`.

- [ ] **Step 5: Implement Placeholder**

Create `apps/web/src/pages/Placeholder.tsx`:

```tsx
interface PlaceholderProps {
  title: string
  issue: string
}

export function Placeholder({ title, issue }: PlaceholderProps) {
  return (
    <section className="flex flex-col gap-6">
      <h1 className="m-0 text-[28px] font-semibold tracking-tight">{title}</h1>
      <div className="rounded-xl border border-dashed border-line-strong bg-surface p-6 text-sm text-muted">
        Coming in {issue}.
      </div>
    </section>
  )
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: PASS (1 test).

- [ ] **Step 7: Tokens, fonts, and remove the starter**

Replace `apps/web/src/index.css`:

```css
@import "tailwindcss";

@theme {
  --font-sans: "IBM Plex Sans", system-ui, sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, monospace;

  --color-ink: #17191e;
  --color-sidebar: #15171b;
  --color-sidebar-active: #2a2e36;
  --color-sidebar-muted: #b4b8bf;
  --color-sidebar-subtle: #a3a7ae;
  --color-sidebar-track: #22252b;
  --color-canvas: #f4f4f1;
  --color-surface: #ffffff;
  --color-line: #e2e2dc;
  --color-line-strong: #d6d6cf;
  --color-muted: #5a5f68;
  --color-teal: #0f6e64;
  --color-teal-dark: #0b5a51;
  --color-teal-soft: #e2f0ec;
  --color-teal-bright: #5bc4b4;
  --color-amber: #e8a33d;
  --color-warn-bg: #fbf0d4;
  --color-warn-fg: #5c3d00;
  --color-danger: #8e2a1b;
}

@layer base {
  html,
  body {
    background: var(--color-canvas);
    color: var(--color-ink);
    font-family: var(--font-sans);
  }

  a {
    color: var(--color-teal);
  }

  a:hover {
    color: var(--color-teal-dark);
  }

  :focus-visible {
    outline: 2px solid var(--color-teal);
    outline-offset: 2px;
  }

  /* teal on the dark sidebar is too faint; use the bright teal there */
  .on-dark :focus-visible {
    outline-color: var(--color-teal-bright);
  }
}
```

Replace `apps/web/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
      rel="stylesheet"
    />
    <title>AgentsOnRails.dev</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Delete the starter files:

```bash
cd apps/web
git rm -q src/App.tsx src/App.css public/icons.svg
git rm -rq src/assets
```

Temporarily point `apps/web/src/main.tsx` at the placeholder (Task 3 replaces this):

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { Placeholder } from './pages/Placeholder'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Placeholder title="AgentsOnRails.dev" issue="D-01" />
  </StrictMode>,
)
```

- [ ] **Step 8: Run tests in CI**

In `.github/workflows/ci.yml`, in the `web` job, add after the `- run: pnpm build` line:

```yaml
      - run: pnpm test
```

- [ ] **Step 9: Verify lint, build, test**

Run: `cd apps/web && npx -y pnpm@12.8.1 lint && npx -y pnpm@12.8.1 build && npx -y pnpm@12.8.1 test`
Expected: all three succeed; the build output contains a CSS file (Tailwind is wired).

- [ ] **Step 10: Commit**

```bash
git add apps/web .github/workflows/ci.yml
git commit -m "feat(web): add Tailwind tokens, Vitest and placeholder page

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Role context with persistence

**Files:**
- Create: `apps/web/src/app/role.ts`, `apps/web/src/app/RoleProvider.tsx`
- Test: `apps/web/src/app/role.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces (from `src/app/role.ts`):
  - `type Role = 'admin' | 'dev' | 'tester'`
  - `ROLES: ReadonlyArray<{ id: Role; label: string; note: string }>` (order: admin, dev, tester)
  - `ROLE_STORAGE_KEY = 'gh.role'`
  - `useRole(): { role: Role; setRole: (role: Role) => void }` (throws outside the provider)
- Produces (from `src/app/RoleProvider.tsx`): `RoleProvider({ children }: { children: ReactNode })`

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/role.test.tsx`:

```tsx
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ROLE_STORAGE_KEY, useRole } from './role'
import { RoleProvider } from './RoleProvider'

const wrapper = ({ children }: { children: ReactNode }) => <RoleProvider>{children}</RoleProvider>

describe('useRole', () => {
  it('defaults to admin when nothing is stored', () => {
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current.role).toBe('admin')
  })

  it('restores the stored role', () => {
    localStorage.setItem(ROLE_STORAGE_KEY, 'dev')
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current.role).toBe('dev')
  })

  it('falls back to admin for an unknown stored value', () => {
    localStorage.setItem(ROLE_STORAGE_KEY, 'superuser')
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current.role).toBe('admin')
  })

  it('persists a new role', () => {
    const { result } = renderHook(() => useRole(), { wrapper })
    act(() => result.current.setRole('tester'))
    expect(result.current.role).toBe('tester')
    expect(localStorage.getItem(ROLE_STORAGE_KEY)).toBe('tester')
  })

  it('still works when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current.role).toBe('admin')
    act(() => result.current.setRole('dev'))
    expect(result.current.role).toBe('dev')
  })

  it('throws outside RoleProvider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useRole())).toThrow('useRole must be used inside RoleProvider')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx -y pnpm@12.8.1 test src/app/role.test.tsx`
Expected: FAIL — cannot resolve `./role`.

- [ ] **Step 3: Implement role.ts**

Create `apps/web/src/app/role.ts`:

```ts
import { createContext, useContext } from 'react'

export type Role = 'admin' | 'dev' | 'tester'

export const ROLES: ReadonlyArray<{ id: Role; label: string; note: string }> = [
  {
    id: 'admin',
    label: 'Admin',
    note: 'Sets mandatory rules and caps, grants exemptions, and decides any approval.',
  },
  {
    id: 'dev',
    label: 'Developer',
    note: 'Member of demo-team. Builds rules and limits, deploys, and decides approvals for demo-team agents.',
  },
  {
    id: 'tester',
    label: 'Tester',
    note: 'Tests deployed agents in the chat and flags replies.',
  },
]

export const ROLE_STORAGE_KEY = 'gh.role'
const DEFAULT_ROLE: Role = 'admin'

function isRole(value: unknown): value is Role {
  return ROLES.some((r) => r.id === value)
}

export function readStoredRole(): Role {
  try {
    const stored = localStorage.getItem(ROLE_STORAGE_KEY)
    return isRole(stored) ? stored : DEFAULT_ROLE
  } catch {
    return DEFAULT_ROLE
  }
}

export function storeRole(role: Role): void {
  try {
    localStorage.setItem(ROLE_STORAGE_KEY, role)
  } catch {
    // storage unavailable (private mode, blocked): the role lives in memory only
  }
}

export interface RoleContextValue {
  role: Role
  setRole: (role: Role) => void
}

export const RoleContext = createContext<RoleContextValue | null>(null)

export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used inside RoleProvider')
  return ctx
}
```

- [ ] **Step 4: Implement RoleProvider.tsx**

Create `apps/web/src/app/RoleProvider.tsx`:

```tsx
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { RoleContext, readStoredRole, storeRole, type Role } from './role'

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<Role>(readStoredRole)

  const setRole = useCallback((next: Role) => {
    setRoleState(next)
    storeRole(next)
  }, [])

  const value = useMemo(() => ({ role, setRole }), [role, setRole])

  return <RoleContext value={value}>{children}</RoleContext>
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: PASS (7 tests).

- [ ] **Step 6: Lint and commit**

Run: `cd apps/web && npx -y pnpm@12.8.1 lint && npx -y pnpm@12.8.1 build`
Expected: no errors.

```bash
git add apps/web/src/app
git commit -m "feat(web): add viewing-role context persisted in localStorage

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Route table, sidebar, layout and role-aware routing

**Files:**
- Create: `apps/web/src/app/nav.ts`, `apps/web/src/app/Brand.tsx`, `apps/web/src/app/Sidebar.tsx`, `apps/web/src/app/Layout.tsx`, `apps/web/src/app/AppRoutes.tsx`, `apps/web/src/test/renderApp.tsx`
- Modify: `apps/web/src/main.tsx`
- Test: `apps/web/src/app/AppRoutes.test.tsx`, `apps/web/src/app/Sidebar.test.tsx`

**Interfaces:**
- Consumes: `Role`, `ROLES`, `ROLE_STORAGE_KEY`, `useRole` (`./role`); `RoleProvider` (`./RoleProvider`); `Placeholder` (`../pages/Placeholder`).
- Produces:
  - `src/app/nav.ts`: `interface NavItem { path: string; label: string; title: string; issue: string }`, `NAV_ITEMS: readonly NavItem[]`, `TESTER_HOME = '/test'`, `DEFAULT_HOME = '/fleet'`, `homeFor(role: Role): string`, `navItemsFor(role: Role): readonly NavItem[]`
  - `src/app/Sidebar.tsx`: `Sidebar({ id, open, onNavigate, counts }: { id: string; open: boolean; onNavigate: () => void; counts?: Partial<Record<string, number>> })`
  - `src/app/Layout.tsx`: `Layout()` — Task 4 adds the drawer to it.
  - `src/app/AppRoutes.tsx`: `AppRoutes()`
  - `src/test/renderApp.tsx`: `renderApp(path: string, role?: Role)` returning RTL's render result; renders a `data-testid="location"` element with the current pathname.

- [ ] **Step 1: Write the test helper**

Create `apps/web/src/test/renderApp.tsx`:

```tsx
import { render } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router'
import { AppRoutes } from '../app/AppRoutes'
import { ROLE_STORAGE_KEY, type Role } from '../app/role'
import { RoleProvider } from '../app/RoleProvider'

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>
}

export function renderApp(path: string, role?: Role) {
  if (role) localStorage.setItem(ROLE_STORAGE_KEY, role)
  return render(
    <MemoryRouter initialEntries={[path]}>
      <RoleProvider>
        <AppRoutes />
        <LocationProbe />
      </RoleProvider>
    </MemoryRouter>,
  )
}
```

- [ ] **Step 2: Write the failing routing tests**

Create `apps/web/src/app/AppRoutes.test.tsx`:

```tsx
import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'
import { NAV_ITEMS } from './nav'

const mainNav = () => screen.getByRole('navigation', { name: 'Main' })
const location = () => screen.getByTestId('location').textContent

describe('AppRoutes', () => {
  it.each(NAV_ITEMS.map((item) => [item.path, item.title] as const))(
    '%s renders the %s page',
    (path, title) => {
      renderApp(path)
      expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    },
  )

  it('lists every nav item for admins', () => {
    renderApp('/fleet')
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(NAV_ITEMS.map((i) => i.label))
  })

  it('redirects / to /fleet', () => {
    renderApp('/')
    expect(location()).toBe('/fleet')
  })

  it('redirects an unknown path to /fleet', () => {
    renderApp('/nope')
    expect(location()).toBe('/fleet')
  })

  it('keeps Agents active on an agent page', () => {
    renderApp('/agents/support-bot')
    expect(screen.getByRole('heading', { level: 1, name: 'Agent' })).toBeInTheDocument()
    expect(within(mainNav()).getByRole('link', { name: 'Agents' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('sends a tester to /test and shows only Test chat', () => {
    renderApp('/fleet', 'tester')
    expect(location()).toBe('/test')
    const labels = within(mainNav())
      .getAllByRole('link')
      .map((a) => a.textContent)
    expect(labels).toEqual(['Test chat'])
  })

  it('sends a tester deep link to /test', () => {
    renderApp('/agents/support-bot', 'tester')
    expect(location()).toBe('/test')
  })

  it('switching to Tester goes to /test, and back to Developer goes to /fleet', async () => {
    const user = userEvent.setup()
    renderApp('/policies')
    await user.click(screen.getByRole('button', { name: 'Tester' }))
    expect(location()).toBe('/test')
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expect(location()).toBe('/fleet')
  })

  it('switching between Admin and Developer keeps the current page', async () => {
    const user = userEvent.setup()
    renderApp('/policies')
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expect(location()).toBe('/policies')
    expect(screen.getByRole('button', { name: 'Developer' })).toHaveAttribute('aria-pressed', 'true')
  })
})
```

- [ ] **Step 3: Write the failing sidebar tests**

Create `apps/web/src/app/Sidebar.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import { RoleProvider } from './RoleProvider'
import { Sidebar } from './Sidebar'

function renderSidebar(counts?: Partial<Record<string, number>>) {
  return render(
    <MemoryRouter initialEntries={['/fleet']}>
      <RoleProvider>
        <Sidebar id="sb" open={false} onNavigate={() => {}} counts={counts} />
      </RoleProvider>
    </MemoryRouter>,
  )
}

describe('Sidebar', () => {
  it('shows a count badge on a nav item when its count is positive', () => {
    renderSidebar({ '/approvals': 3 })
    const approvals = screen.getByRole('link', { name: /Approvals/ })
    expect(within(approvals).getByText('3')).toBeInTheDocument()
  })

  it('shows no badge when the count is zero', () => {
    renderSidebar({ '/approvals': 0 })
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument()
  })

  it('shows the note for the current role', () => {
    renderSidebar()
    expect(
      screen.getByText('Sets mandatory rules and caps, grants exemptions, and decides any approval.'),
    ).toBeInTheDocument()
  })
})
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: FAIL — cannot resolve `../app/AppRoutes`, `./nav`, `./Sidebar`.

- [ ] **Step 5: Implement nav.ts**

Create `apps/web/src/app/nav.ts`:

```ts
import type { Role } from './role'

export interface NavItem {
  path: string
  label: string
  title: string
  issue: string
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/fleet', label: 'Fleet', title: 'Fleet', issue: 'D-06' },
  { path: '/approvals', label: 'Approvals', title: 'Approvals', issue: 'D-06' },
  { path: '/agents', label: 'Agents', title: 'Agents', issue: 'D-02' },
  { path: '/guardrails', label: 'Guardrails', title: 'Guardrails', issue: 'D-05' },
  { path: '/policies', label: 'Policies', title: 'Policies', issue: 'D-05' },
  { path: '/audit', label: 'Audit log', title: 'Audit log', issue: 'D-06' },
  { path: '/mcp', label: 'MCP servers', title: 'MCP servers', issue: 'S-02' },
  { path: '/evals', label: 'Evaluators', title: 'Evaluators', issue: 'S-01' },
  { path: '/test', label: 'Test chat', title: 'Test chat', issue: 'E-03' },
]

export const TESTER_HOME = '/test'
export const DEFAULT_HOME = '/fleet'

export function homeFor(role: Role): string {
  return role === 'tester' ? TESTER_HOME : DEFAULT_HOME
}

export function navItemsFor(role: Role): readonly NavItem[] {
  return role === 'tester' ? NAV_ITEMS.filter((item) => item.path === TESTER_HOME) : NAV_ITEMS
}
```

- [ ] **Step 6: Implement Brand.tsx**

Create `apps/web/src/app/Brand.tsx`:

```tsx
export function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <svg
        width="28"
        height="28"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="shrink-0 text-teal-bright"
      >
        <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
      <div className="flex flex-col">
        <span className="text-base font-bold text-white">AgentsOnRails.dev</span>
        <span className="text-xs text-sidebar-subtle">Acme workspace</span>
      </div>
    </div>
  )
}
```

- [ ] **Step 7: Implement Sidebar.tsx**

Create `apps/web/src/app/Sidebar.tsx`:

```tsx
import { NavLink, useNavigate } from 'react-router'
import { Brand } from './Brand'
import { DEFAULT_HOME, TESTER_HOME, navItemsFor } from './nav'
import { ROLES, useRole, type Role } from './role'

interface SidebarProps {
  id: string
  open: boolean
  onNavigate: () => void
  counts?: Partial<Record<string, number>>
}

export function Sidebar({ id, open, onNavigate, counts = {} }: SidebarProps) {
  const { role, setRole } = useRole()
  const navigate = useNavigate()
  const note = ROLES.find((r) => r.id === role)?.note

  const pickRole = (next: Role) => {
    if (next !== role) {
      setRole(next)
      if (next === 'tester') navigate(TESTER_HOME)
      else if (role === 'tester') navigate(DEFAULT_HOME)
    }
    onNavigate()
  }

  return (
    <aside
      id={id}
      data-open={open}
      className={`on-dark fixed inset-y-0 left-0 z-40 flex w-[min(280px,85vw)] flex-col gap-7 overflow-y-auto bg-sidebar px-4 py-6 text-white transition-transform md:sticky md:top-0 md:z-auto md:h-screen md:w-60 md:shrink-0 md:translate-x-0 ${
        open ? 'translate-x-0' : 'max-md:invisible -translate-x-full'
      }`}
    >
      <Brand />
      <nav aria-label="Main" className="flex flex-col gap-1">
        {navItemsFor(role).map((item) => {
          const count = counts[item.path] ?? 0
          return (
            <NavLink
              key={item.path}
              to={item.path}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex min-h-11 items-center justify-between gap-2 rounded-lg px-3 text-sm no-underline ${
                  isActive
                    ? 'bg-sidebar-active font-semibold text-white hover:text-white'
                    : 'font-medium text-sidebar-muted hover:bg-sidebar-active/60 hover:text-white'
                }`
              }
            >
              <span>{item.label}</span>
              {count > 0 && (
                <span className="min-w-[22px] rounded-full bg-amber px-[7px] py-px text-center text-xs font-bold text-sidebar">
                  {count}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>
      <div className="mt-auto flex flex-col gap-2 px-2">
        <span id={`${id}-role-label`} className="text-xs tracking-[0.06em] text-sidebar-subtle uppercase">
          Viewing as
        </span>
        <div
          role="group"
          aria-labelledby={`${id}-role-label`}
          className="flex gap-1 rounded-[10px] bg-sidebar-track p-1"
        >
          {ROLES.map((r) => {
            const on = r.id === role
            return (
              <button
                key={r.id}
                type="button"
                aria-pressed={on}
                onClick={() => pickRole(r.id)}
                className={`min-h-11 flex-1 cursor-pointer rounded-[7px] border-0 px-1.5 text-xs font-semibold ${
                  on ? 'bg-white text-sidebar' : 'bg-transparent text-sidebar-muted hover:text-white'
                }`}
              >
                {r.label}
              </button>
            )
          })}
        </div>
        <p className="m-0 text-xs leading-[1.45] text-sidebar-subtle">{note}</p>
      </div>
    </aside>
  )
}
```

- [ ] **Step 8: Implement Layout.tsx (no drawer yet)**

Create `apps/web/src/app/Layout.tsx`:

```tsx
import { Outlet } from 'react-router'
import { Sidebar } from './Sidebar'

export function Layout() {
  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      <Sidebar id="app-sidebar" open={false} onNavigate={() => {}} />
      <main className="min-w-0 flex-1 px-[clamp(16px,4vw,40px)] pt-8 pb-12">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 9: Implement AppRoutes.tsx**

Create `apps/web/src/app/AppRoutes.tsx`:

```tsx
import { Navigate, Route, Routes } from 'react-router'
import { Placeholder } from '../pages/Placeholder'
import { Layout } from './Layout'
import { homeFor, navItemsFor } from './nav'
import { useRole } from './role'

export function AppRoutes() {
  const { role } = useRole()

  return (
    <Routes>
      <Route element={<Layout />}>
        {navItemsFor(role).map((item) => (
          <Route
            key={item.path}
            path={item.path}
            element={<Placeholder title={item.title} issue={item.issue} />}
          />
        ))}
        {role !== 'tester' && (
          <Route path="/agents/:agentId" element={<Placeholder title="Agent" issue="D-03 / D-04" />} />
        )}
        <Route path="*" element={<Navigate to={homeFor(role)} replace />} />
      </Route>
    </Routes>
  )
}
```

- [ ] **Step 10: Mount the app**

Replace `apps/web/src/main.tsx`:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { AppRoutes } from './app/AppRoutes'
import { RoleProvider } from './app/RoleProvider'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <RoleProvider>
        <AppRoutes />
      </RoleProvider>
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: PASS (all Placeholder, role, AppRoutes and Sidebar tests).

- [ ] **Step 12: Lint, build, commit**

Run: `cd apps/web && npx -y pnpm@12.8.1 lint && npx -y pnpm@12.8.1 build`
Expected: no errors.

```bash
git add apps/web/src
git commit -m "feat(web): add sidebar, routes and role-aware navigation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Phone-width top bar and drawer

**Files:**
- Modify: `apps/web/src/app/Layout.tsx`
- Test: `apps/web/src/app/Layout.test.tsx`

**Interfaces:**
- Consumes: `Sidebar` (Task 3), `Brand` (Task 3), `renderApp` (Task 3).
- Produces: a "Menu" button (`aria-expanded`, `aria-controls="app-sidebar"`) and a "Close menu" backdrop button; the sidebar's `data-open` attribute reflects the drawer state.

- [ ] **Step 1: Write the failing tests**

Create `apps/web/src/app/Layout.test.tsx`:

```tsx
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '../test/renderApp'

const menuButton = () => screen.getByRole('button', { name: 'Menu' })
const sidebar = () => document.getElementById('app-sidebar')

async function openMenu() {
  const user = userEvent.setup()
  renderApp('/fleet')
  await user.click(menuButton())
  expect(menuButton()).toHaveAttribute('aria-expanded', 'true')
  expect(sidebar()).toHaveAttribute('data-open', 'true')
  return user
}

function expectClosed() {
  expect(menuButton()).toHaveAttribute('aria-expanded', 'false')
  expect(sidebar()).toHaveAttribute('data-open', 'false')
  expect(screen.queryByRole('button', { name: 'Close menu' })).not.toBeInTheDocument()
}

describe('phone drawer', () => {
  it('starts closed', () => {
    renderApp('/fleet')
    expectClosed()
  })

  it('closes on Escape', async () => {
    const user = await openMenu()
    await user.keyboard('{Escape}')
    expectClosed()
  })

  it('closes when a nav item is picked', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('link', { name: 'Policies' }))
    expectClosed()
    expect(screen.getByRole('heading', { level: 1, name: 'Policies' })).toBeInTheDocument()
  })

  it('closes when the backdrop is clicked', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Close menu' }))
    expectClosed()
  })

  it('closes when the role changes', async () => {
    const user = await openMenu()
    await user.click(screen.getByRole('button', { name: 'Developer' }))
    expectClosed()
  })

  it('toggles closed with the Menu button', async () => {
    const user = await openMenu()
    await user.click(menuButton())
    expectClosed()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/web && npx -y pnpm@12.8.1 test src/app/Layout.test.tsx`
Expected: FAIL — no button named "Menu".

- [ ] **Step 3: Implement the drawer**

Replace `apps/web/src/app/Layout.tsx`:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { Outlet } from 'react-router'
import { Brand } from './Brand'
import { Sidebar } from './Sidebar'

const SIDEBAR_ID = 'app-sidebar'

export function Layout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <div className="min-h-screen bg-canvas text-ink md:flex">
      <header className="on-dark sticky top-0 z-20 flex h-14 items-center justify-between bg-sidebar px-2 md:hidden">
        <Brand />
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls={SIDEBAR_ID}
          onClick={() => setMenuOpen((open) => !open)}
          className="min-h-11 cursor-pointer rounded-lg border-0 bg-transparent px-3 text-sm font-semibold text-sidebar-muted hover:bg-sidebar-active hover:text-white"
        >
          Menu
        </button>
      </header>
      {menuOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={closeMenu}
          className="fixed inset-0 z-30 cursor-default border-0 bg-black/40 md:hidden"
        />
      )}
      <Sidebar id={SIDEBAR_ID} open={menuOpen} onNavigate={closeMenu} />
      <main className="min-w-0 flex-1 px-[clamp(16px,4vw,40px)] pt-8 pb-12">
        <Outlet />
      </main>
    </div>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd apps/web && npx -y pnpm@12.8.1 test`
Expected: PASS (all tests, including the 6 drawer tests).

- [ ] **Step 5: Lint, build, commit**

Run: `cd apps/web && npx -y pnpm@12.8.1 lint && npx -y pnpm@12.8.1 build`
Expected: no errors.

```bash
git add apps/web/src/app
git commit -m "feat(web): add phone-width top bar and sidebar drawer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Full verification and browser check

**Files:** none changed unless a check fails.

- [ ] **Step 1: Repo checks**

Run from the repo root:

```bash
make lint && make test
cd apps/web && npx -y pnpm@12.8.1 install --frozen-lockfile && npx -y pnpm@12.8.1 lint && npx -y pnpm@12.8.1 build && npx -y pnpm@12.8.1 test
```

Expected: everything passes; `--frozen-lockfile` succeeds (lockfile is in sync).

- [ ] **Step 2: Browser check**

Start `cd apps/web && npx -y pnpm@12.8.1 dev` (port 5173) and check in a browser:

- At 1280px wide: dark 240px sidebar, IBM Plex Sans renders, `/fleet` active, every nav item opens its titled placeholder, `/agents/x` keeps Agents highlighted.
- Role switcher: Tester shows only "Test chat" at `/test`; back to Developer lands on `/fleet`; reload keeps the role.
- At 390px wide: top bar with "Menu", no horizontal scroll, drawer opens and closes (nav item, Esc, backdrop), page content is not hidden behind the top bar.

Expected: all hold. Fix anything that doesn't, re-run Step 1, and commit with a `fix(web):` message.
