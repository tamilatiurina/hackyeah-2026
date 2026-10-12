# Web app shell (D-01, layout only) — design

Issue: #54 (D-01 App shell on the mock API). Date: 2026-10-03.

## Goal

Replace the Vite starter in `apps/web` with the AgentsOnRails.dev control panel shell from the
"AgentsOnRails.dev Control Panel" prototype, so the D-02..D-06 and E-03 screens can be built on it.

## Scope

In scope: routing, layout (sidebar + main), visual tokens, role switcher, phone-width layout,
placeholder pages, tests.

Out of scope (deferred until T-02 / #29 lands): API client, generated types, mock server,
mock/real env switch, live approvals count. #54 stays open until those are done.

## Decisions

- Router: `react-router` v7 in library mode.
- Styling: Tailwind CSS v4 via `@tailwindcss/vite`, prototype colors as `@theme` tokens.
- Tests: Vitest + Testing Library + jsdom, run with `pnpm test`.
- Light theme only (the prototype has no dark mode).

## Structure (`apps/web/src`)

| File | Purpose |
|---|---|
| `main.tsx` | Mounts `BrowserRouter`, `RoleProvider`, `AppRoutes` |
| `index.css` | `@import "tailwindcss"`, `@theme` tokens, base font and focus ring |
| `app/routes.tsx` | Route table: single source for nav items and `<Routes>` |
| `app/Layout.tsx` | Sidebar + `<main><Outlet/></main>`, phone top bar and drawer |
| `app/Sidebar.tsx` | Brand, nav, role switcher, role note |
| `app/role.tsx` | `RoleProvider`, `useRole()`; role persisted in `localStorage` |
| `pages/Placeholder.tsx` | Page title + "Coming in <issue>" empty state |

The starter `App.tsx`, `App.css` and `assets/` are deleted.

## Routes

| Path | Nav label | Owner issue |
|---|---|---|
| `/fleet` | Fleet | D-06 |
| `/approvals` | Approvals | D-06 |
| `/agents` | Agents | D-02 |
| `/agents/:agentId` | (Agents is active) | D-03 / D-04 |
| `/guardrails` | Guardrails | D-05 |
| `/policies` | Policies | D-05 |
| `/audit` | Audit log | D-06 |
| `/mcp` | MCP servers | S-02 |
| `/evals` | Evaluators | S-01 |
| `/test` | Test chat | E-03 |

`/` and unknown paths redirect to `/fleet`. Nav items support an amber count badge (used later
for pending approvals); it is hidden for now.

## Roles

Roles are `admin`, `dev` ("Developer") and `tester`, with the prototype's notes:

- admin: "Sets mandatory rules and caps, grants exemptions, and decides any approval."
- dev: "Member of demo-team. Builds rules and limits, deploys, and decides approvals for
  demo-team agents."
- tester: "Tests deployed agents in the chat and flags replies."

Default role is `admin`. The role is stored in `localStorage` (key `gh.role`; reads and writes
wrapped in try/catch, invalid values fall back to the default).

Tester rules: the nav shows only "Test chat"; any other route redirects to `/test`. Switching
from tester to another role navigates to `/fleet`; switching to tester navigates to `/test`.

## Visual tokens

`ink #17191E`, `sidebar #15171B`, `sidebar-active #2A2E36`, `sidebar-muted #B4B8BF`,
`sidebar-subtle #A3A7AE`, `sidebar-track #22252B`, `canvas #F4F4F1`, `surface #FFFFFF`,
`line #E2E2DC`, `line-strong #D6D6CF`, `muted #5A5F68`, `teal #0F6E64`, `teal-dark #0B5A51`,
`teal-soft #E2F0EC`, `teal-bright #5BC4B4`, `amber #E8A33D`, `warn-bg #FBF0D4`,
`warn-fg #5C3D00`, `danger #8E2A1B`.

Fonts: IBM Plex Sans (400/500/600/700) and IBM Plex Mono (400/500) from Google Fonts, linked in
`index.html`. Focus: 2px teal outline, 2px offset. Nav items and buttons are at least 44px tall.

## Layout

- ≥768px: fixed 240px dark sidebar on the left; `main` fills the rest and scrolls, padding
  `32px clamp(16px, 4vw, 40px) 48px`.
- <768px: slim dark top bar with logo and a "Menu" button (`aria-expanded`). The sidebar opens
  as an overlay drawer with a backdrop; it closes on nav click, role change, Esc, or backdrop
  click. No horizontal page scroll.

## Testing

Vitest tests in `apps/web/src/**/*.test.tsx`:

1. Each nav route renders its page title.
2. As tester, visiting `/fleet` redirects to `/test` and the nav has only "Test chat".
3. Switching from tester to Developer lands on `/fleet`.
4. The chosen role is restored from `localStorage`.

Done when `pnpm lint`, `pnpm build` and `pnpm test` pass in `apps/web`, the lockfile is
updated, and the shell is checked in a browser at desktop and phone widths.
