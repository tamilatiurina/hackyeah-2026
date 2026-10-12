# AgentsOnRails.dev UI conventions

AgentsOnRails.dev is a control room for AI agents: calm, dense, operational. Off-white canvas, white surfaces with hairline borders, one teal accent, a near-black sidebar. IBM Plex Sans for text, IBM Plex Mono for URLs, ids and code.

## Styling idiom: Tailwind utilities on brand tokens

There are no component variants and no CSS-in-JS. Style everything, including your own layout glue, with Tailwind utility classes from `styles.css`. Only use the brand color names below, never Tailwind's default palette (`bg-red-500`, `text-gray-600` are not part of this system and are not shipped).

| Role | Classes |
|---|---|
| Page background | `bg-canvas` |
| Card / table surface | `bg-surface border border-line rounded-xl` |
| Body text / secondary text | `text-ink` / `text-muted` |
| Borders | `border-line` (default), `border-line-strong` (inputs, dashed empties) |
| Accent | `bg-teal`, `hover:bg-teal-dark`, `text-teal`, `text-teal-dark`, `bg-teal-soft` (selected row, success pill) |
| Warning | `bg-warn-bg text-warn-fg`; error text `text-danger` |
| Sidebar | `bg-sidebar`, `bg-sidebar-active`, `bg-sidebar-track`, `text-sidebar-muted`, `text-sidebar-subtle`, `text-teal-bright` |
| Count badge | `bg-amber` |
| Code / URLs | `font-mono text-[13px]` |

Tokens are also CSS variables: `var(--color-teal)`, `var(--color-line)`, `var(--font-sans)`, `var(--font-mono)`.

Rhythm: pages stack sections with `gap-7` (PageShell does this); cards use `p-5`, table cells `px-5 py-4`; controls are `min-h-11` tall with `rounded-lg`. Table headers: `bg-[#F9F9F6]` row, `text-[11px] tracking-[0.08em] text-muted uppercase font-semibold`.

## Controls are class strings, not components

Buttons, inputs and badges are plain elements styled with exported class strings. Use them instead of inventing button styles:

```jsx
const { buttonPrimary, buttonSecondary, inputClass, badgeClass, pillClass } = window.AgentsOnRails
<button className={buttonPrimary}>Register agent</button>
<button className={buttonSecondary}>Cancel</button>
<input className={inputClass} aria-invalid={false} />
<span className={`${pillClass} bg-teal-soft text-teal-dark`}>Active</span>
<span className={`${badgeClass} bg-warn-bg text-warn-fg`}>Draft</span>
```

## Page anatomy

Every page is `PageShell` > `PageHeader` > content. Lists show `LoadingRows` while loading, `EmptyState` when empty, and a `<table>` inside `TableFrame` otherwise. `LiveBadge` goes in `PageHeader` `actions` for pages with live updates. A status pill beside the title goes in `PageHeader` `badge` (agents: `bg-warn-bg text-warn-fg` "Setup · 2 of 5" until live, then `bg-teal-soft text-teal-dark` "Live"). Inside `Layout`, `useToast()` returns a function that shows a short top-right confirmation (e.g. `toast('Guarded URL copied.')`).

```jsx
const { PageShell, PageHeader, TableFrame, buttonPrimary } = window.AgentsOnRails
<div className="bg-canvas p-6">
  <PageShell>
    <PageHeader title="Agents" description="Proxy agents sit behind a guarded URL."
      actions={<button className={buttonPrimary}>Register agent</button>} />
    <TableFrame label="Agents table">
      <table className="w-full border-collapse text-left text-sm">…</table>
    </TableFrame>
  </PageShell>
</div>
```

## App shell setup

`Sidebar` and `Layout` read a router and the auth context, and throw without them. `Layout` renders the routed page through `<Outlet>`, so use it as a parent route. Wrap like this (all exported from the bundle, react-router included):

```jsx
const { MemoryRouter, Routes, Route, AuthContext, Layout } = window.AgentsOnRails
const auth = { status: 'ready', configured: true, notice: null, watchTables: null,
  session: { accessToken: '', userId: 'preview-user', email: 'maria@acme.dev' },
  signIn: async () => null, signUp: async () => ({ error: null, confirmEmail: false }),
  signInWithOAuth: async () => null, sendPasswordReset: async () => null,
  updatePassword: async () => null, signOut: async () => {} }
<MemoryRouter initialEntries={['/agents']}>
  <AuthContext value={auth}>
    <Routes><Route element={<Layout />}><Route path="*" element={<YourPage />} /></Route></Routes>
  </AuthContext>
</MemoryRouter>
```

The nav is Agents, then a Library section (Guardrails, MCP servers) and a Monitor section (Sessions, Audit log, Security). There are no roles: every signed-in user manages their own workspace. The nav highlights the link matching the router path. `Brand` has white text: only place it on `bg-sidebar` inside an `on-dark` wrapper.

## Where the truth lives

Read `styles.css` and its import `_ds_bundle.css` (compiled Tailwind with the `@theme` tokens) before styling, and `components/<group>/<Name>/<Name>.prompt.md` for each component's props and examples.
