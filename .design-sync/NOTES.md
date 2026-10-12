# design-sync notes (AgentsOnRails.dev)

Target project: https://claude.ai/design/p/7365b80c-ef07-43b7-b3be-8b9f447b6b53 (pinned in config.json).

## How this repo is synced

- `apps/web` is an app, not a published library: no `dist/` entry and no `.d.ts` tree. The converter bundles the barrel `apps/web/src/ui/index.ts` (`cfg.entry`), which re-exports the UI primitives, the app shell (Brand, Sidebar, Layout), the class strings from `src/ui/classes.ts` and the Auth/Role contexts the shell reads. New shared components must be added to that barrel AND to `cfg.componentSrcMap`.
- Props are hand-written in `cfg.dtsPropsFor` (no `.d.ts` to extract from). If a component's props change in source, update its entry there or the uploaded contract goes stale.
- `react-router` is merged into `window.AgentsOnRails` via `cfg.extraEntries`, so previews and designs can use `MemoryRouter`/`Routes`/`Route`. Previews import everything from `'web'`.
- CSS: run `cfg.buildCmd` (`node .design-sync/build-css.mjs`) before the converter. The app's vite CSS only holds utilities its own source uses; build-css compiles the real `src/index.css` (`@theme` tokens) with app sources, `.design-sync/previews/` and a safelist of brand-token utility families into `apps/web/dist/ds.css` (`cfg.cssEntry`, gitignored). A class used in a new preview only exists after build-css reruns, and `preview-rebuild.mjs` does NOT recopy CSS: do a full `package-build.mjs` after CSS changes.
- Fonts: IBM Plex Sans/Mono come from Google Fonts via an `@import url(...)` that build-css prepends (same URL as `apps/web/index.html`). `[FONT_REMOTE]` is expected.
- Render check: the cached chromium is build 1208, which needs `playwright@1.58.2` in `.ds-sync/`.
- Node used: system node with pnpm 12 (apps/web `packageManager`).

## Preview decisions

- Page-level previews sit in `bg-canvas p-6` so they read like the app (the app body is canvas).
- Sidebar and Layout throw without a router + `AuthContext`; their previews pass a stub auth value (no Supabase). Both use `cardMode: single` (Sidebar 900x820, Layout 1280x800) because Sidebar is `md:h-screen` / a fixed drawer below 768px.
- TableFrame story tables are kept at `min-w-[560px]`: the product pane is <=728px wide and a 920px table clips its last column in the card.
- Brand renders white text, so its previews sit on `bg-sidebar` inside `on-dark`.

## Known render warns

- None at the last sync (9/9 clean, 0 thin, 0 identical).

## Re-sync risks

- `cfg.dtsPropsFor` is a hand copy of the props in `src/ui/Page.tsx`, `src/app/Brand.tsx`, `src/app/Sidebar.tsx`: it silently drifts when those signatures change.
- The safelist in `build-css.mjs` mirrors the color names in `src/index.css` `@theme`: a new or renamed token needs adding there too (and to `conventions.md`).
- The Sidebar/Layout previews and the conventions snippet hand-build an `AuthState` value: if `src/auth/context.ts` `AuthState` changes shape, update both.
- Nav labels shown in the previews come from `src/app/nav.ts` at render time, so they stay current; the list in `conventions.md` does not.
- Google Fonts is fetched at runtime; renders were verified with network access.
- The Layout `AgentsPage` preview hand-copies the agents list markup from `src/pages/agents/AgentsTable.tsx` (columns, status pills, next-step buttons): restyle that table and the preview goes stale.
- `pnpm build` in `apps/web` wipes `dist/`, including `dist/ds.css`: always re-run `cfg.buildCmd` before the converter.
- The project also holds files this sync does not own (`templates/agent-flow/**`, `screenshots/**`, `Canvas.dc.html`, `support.js`, authored in Claude Design). Never put them in an upload plan's deletes.
