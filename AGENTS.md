# AGENTS.md

Instructions for AI coding agents working in this repository.

## Problem

Goldman Sachs asked us to build a lightweight, flexible **AI Control Layer** for a hackathon: a
gateway, proxy, middleware or SDK wrapper that intercepts and governs interactions with AI
systems. It must enforce security, privacy and resource controls that come from a centralized
configuration source (a control catalog), and it must produce reporting for both security teams
and management.

Judges will run our test suite, poke the running system with ad-hoc prompts, and edit our
configuration live to see whether the control layer adapts without a restart. Scoring:
guardrail robustness 30%, architecture and performance 20%, security reporting 20%, self-testing
suite 15%, practical implementability 15%.

## Our approach

The backend is the middleware between the employee and the agents running elsewhere. A prompt
never goes straight to an agent: it goes through our API, which resolves who the caller is (user
and role) and which agent they are talking to, runs the resolved guardrails on the way in,
forwards the request, and runs the output guardrails on the reply. The control catalog lives in
our database, not in the agents, so agents stay stateless and unaware of policy.

Two kinds of control have to coexist: **deterministic** (regex, PII patterns, signatures, auth
and budget checks) and **semantic** (model-based judgement). Both must be visible in the same
trace and the same report.

## Project layout

- `apps/api` – FastAPI backend. **Standalone uv project**: its own `pyproject.toml`, `uv.lock`
  and `.venv`, excluded from the root workspace. Python package is `app`, routes are mounted
  under `/api/v1`.
- `apps/web` – React + Vite + TypeScript panel (pnpm project, not part of the uv workspace).
- `apps/cli` – Typer CLI (`acme-cli`, module `acme_cli`, command `acme`), in the root workspace.
- `apps/agents` – demo A2A agents used to show the control layer off. Plain `requirements.txt`,
  not part of any workspace. The support assistant is deliberately unguarded: its system prompt
  holds a customer record and an internal note, so it leaks them when asked. That is the
  "before" picture our guardrails fix.
- `apps/test-agent` – deterministic A2A 1.0 test agent (`acme-test-agent`, run with
  `make test-agent`), in the root workspace. Trigger messages (`#pii`, `#inject`, `#slow N`, …)
  set off each guardrail and limit.
- `packages/core` – shared Python library (`acme-core`, module `acme_core`) for code used by
  both the CLI and the API.

The root uv workspace is `apps/cli` + `apps/test-agent` + `packages/*` with one `uv.lock` and
one `.venv`.
`apps/api` is synced separately. Python 3.12 everywhere.

## Commands

Run from the repo root unless stated otherwise.

```bash
make install   # all Python + web deps
make api       # API on :8000 (auto-reload)
make web       # web dev server on :5173
make lint      # ruff check + ruff format --check + mypy (cli and packages)
make test      # pytest for the root workspace (cli + packages)
make supabase  # local Supabase via Docker, applies migrations, writes .env files

cd apps/api && uv run pytest -q    # the API suite lives in its own project
uv run ruff format . && uv run ruff check . --fix   # auto-fix style, whole repo

cd apps/web && pnpm lint   # oxlint
cd apps/web && pnpm build  # type-check + production build
cd apps/web && pnpm test   # vitest
```

## The control catalog

This is the part that scores points. Know it before changing anything near it.

### Guardrail library (`apps/api/app/guardrails`)

A guardrail is one rule from the company library: a `template` (`pii`, `prompt_injection`,
`toxicity`, `topic`, `regex`, `llm_judge`), the `engine` that runs it (`regex`, `library`,
`moderation`, `llm_judge`), the `stages` it applies to (`input`, `output`) and an `action`
(`block`, `redact`, `warn`). `TEMPLATES` in `models.py` restricts which engines and actions each
template allows; validation happens there, not in routes.

`evaluate.py` is the dry run (FR-20). Regex, PII and injection-signature matching are real.
`llm_judge` and `moderation` are keyword heuristics for now and every result they produce is
flagged `simulated: true` — never report a simulated verdict as a real one. Replacing these with
a local model is the highest-value open work.

User-supplied patterns run through the `regex` package with a timeout, because a catastrophic
backtrack on `re` would hold the GIL.

### Mandatory guardrails

A guardrail with `is_mandatory` applies to every request, runs before everything else, and
cannot be attached or detached. It is the floor of the posture, not a binding.

### Bindings (`apps/api/app/bindings`)

A binding attaches one library guardrail to one scope: `agent` (what the agent can do), `role`
(what a rank of employee may see) or `user` (an exemption or an extra check). Resolution rules,
implemented in `resolve.py`, are the contract every consumer must respect:

1. Mandatory guardrails first, in library order.
2. Then bindings whose scope matches the request. Scopes are **unioned**, never replaced.
3. Disabled bindings and disabled guardrails are skipped.
4. A guardrail bound from several scopes runs once, at its strongest position: lowest
   `order_index` wins, then agent before role before user.
5. The result is split per stage; a guardrail only lands on the stages it declares.

`GET /api/v1/effective-guardrails?agent_id=&role=&user_id=` returns exactly what the gateway
should run, each entry carrying the `source` that put it there. With no parameters it returns
the mandatory floor. The `version` field is a hash of the resolved set: cache an effective
policy under it, and config edits are picked up on the next request without a restart.

Attach, detach and reorder through `POST`, `PATCH` and `DELETE /api/v1/bindings`.

### Agents speak A2A 1.0

Every agent the API registers, calls or exposes speaks [A2A 1.0](https://a2a-protocol.org/v1.0.0/specification/)
over JSON-RPC, as profiled in `docs/agent-contract-a2a.md`. That doc is the source of truth; don't
invent other agent payload formats. Registration reads the agent's Agent Card from
`<base_url>/.well-known/agent-card.json`; `upstream_url` is the card's JSON-RPC endpoint and
`agent_card` the stored snapshot. Use the A2A spec's field names (`messageId`, `contextId`,
`parts`, `ROLE_USER`, `TASK_STATE_REJECTED`, …); hub data goes only in A2A `metadata` under the
`guardrailHub` key. Use `apps/test-agent` to exercise anything that talks to an agent. pi coding
agents are a separate feature, not part of this app.

### Injection signatures

The signature list lives in `app/seeds.py` and is served and edited through `/api/v1/signatures`.
Treat it as a feed that an external system could replace: adding a signature must take effect
without a code change.

## Rules

### Python

- Use **uv** for everything. Never `pip`, `python -m venv` or `poetry`.
- Dependencies go to the project that needs them: `cd apps/api && uv add <dep>` for the API,
  `uv add --package acme-cli <dep>` for the CLI, `uv add --dev <dep>` for root dev tooling.
- Never edit a lockfile by hand. If a `pyproject.toml` changes, run `uv lock` in that project.
- Full type hints; mypy runs in strict mode over `apps/cli` and `packages`.
- Ruff is the formatter and linter (line length 100). Don't add black, isort or flake8.
- **Don't write tests unless the user explicitly asks for them.**

### API

- Every route lives under `/api/v1` (`settings.API_V1_STR`); the web dev server proxies `/api/*`.
- Pydantic models for request and response bodies, never raw dicts, beyond trivial endpoints.
- Storage follows one pattern per entity: a `Repository` Protocol with an in-memory
  implementation (the seeded `app/store.py`, used locally and in tests) and a Supabase one.
  Routes depend on the Protocol and never on a concrete backend. Without `SUPABASE_URL` and
  `SUPABASE_KEY` the in-memory store is used; with them, a bearer token is required.
- Supabase schema changes are migrations in `apps/api/supabase/migrations`, named
  `<timestamp>_<what>.sql`. A new column means three edits in one change: the migration, the
  `_COLUMNS` list in the repository, and the Pydantic model. A field that exists only in the
  model is silently dropped on every write — that already happened once with `is_mandatory`.
- Row level security is on for every table; the service role bypasses it, signed-in users get
  explicit policies, anon gets nothing.

### Web

- Use **pnpm** only. Never `npm` or `yarn`; never create `package-lock.json` or `yarn.lock`.
- Run pnpm commands inside `apps/web`.
- After any `package.json` change run `pnpm install` so `pnpm-lock.yaml` stays in sync
  (CI uses `--frozen-lockfile`).
- TypeScript only; no `any` unless unavoidable and commented.
- Call the backend with relative URLs (`fetch("/api/v1/...")`), never `http://localhost:8000`.

## Before finishing a task

1. `make lint` passes.
2. `make test` passes, and `cd apps/api && uv run pytest -q` passes if API code changed.
3. If web code changed: `cd apps/web && pnpm lint && pnpm build` passes.
4. Lockfiles are updated if dependencies changed.

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`, `refactor:`.
- Never commit `.env` files, secrets, `.venv/` or `node_modules/`.
- Don't push or force-push unless explicitly asked.
