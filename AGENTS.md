# AGENTS.md

Instructions for AI coding agents working in this repository.
## Project overview

Monorepo with three apps and one shared library:

- `apps/api` – FastAPI backend (Python package `acme-api`, module `acme_api`)
- `apps/cli` – Typer CLI (Python package `acme-cli`, module `acme_cli`, command `acme`)
- `apps/web` – React + Vite + TypeScript frontend (pnpm project, NOT part of the uv workspace)
- `apps/landing` – static Astro marketing page (pnpm project, NOT part of the uv workspace; the Web rules below apply to it too)
- `packages/core` – shared Python library (package `acme-core`, module `acme_core`) used by API and CLI

Python code is a single uv workspace: one `uv.lock` and one `.venv` at the repo root. Python 3.12.

## Commands

Run all commands from the repo root unless stated otherwise.

```bash
make install                      # install all Python + web deps
make api                          # run API on :8000 (auto-reload)
make web                          # run web dev server on :5173
make landing                      # run Astro landing page on :4321
make lint                         # ruff check + ruff format --check + mypy
make test                         # pytest

uv run pytest path/to/test_file.py        # run a single test file
uv run ruff format . && uv run ruff check . --fix   # auto-fix style

cd apps/web && pnpm lint          # oxlint
cd apps/web && pnpm build         # type-check + production build
```

## Rules

### Python
- Use **uv** for everything. Never use `pip`, `pip install`, `python -m venv`, or `poetry`.
- Add dependencies to the package that needs them: `uv add --package acme-api <dep>`. Dev tools go to the root: `uv add --dev <dep>`.
- Never edit `uv.lock` by hand. If `pyproject.toml` changes, run `uv lock`.
- Use the `src/` layout: code in `apps/<app>/src/<module>/`, tests in `apps/<app>/tests/`.
- Code shared by API and CLI belongs in `packages/core`, not duplicated in both apps.
- API and CLI must not import from each other; both may import from `acme_core`.
- Full type hints everywhere; mypy runs in strict mode.
- Ruff is the formatter and linter (line length 100). Don't add black, isort or flake8.
- Every new feature or bug fix gets a pytest test.

### API
- All routes live under the `/api` prefix (the web dev server proxies `/api/*` to the API).
- Use Pydantic models for request and response bodies, not raw dicts, for anything beyond trivial endpoints.

### Web
- Use **pnpm** only. Never use `npm` or `yarn`; never create `package-lock.json` or `yarn.lock`.
- Run pnpm commands inside `apps/web`.
- After any change to `package.json`, run `pnpm install` so `pnpm-lock.yaml` stays in sync (CI uses `--frozen-lockfile`).
- TypeScript only (`.ts`/`.tsx`); no `any` unless unavoidable and commented.
- Call the backend with relative URLs (`fetch("/api/...")`), never hard-coded `http://localhost:8000`.

## Before finishing a task

1. `make lint` passes
2. `make test` passes
3. If web code changed: `cd apps/web && pnpm lint && pnpm build` passes (same in `apps/landing` if it changed)
4. Lockfiles (`uv.lock`, `apps/web/pnpm-lock.yaml`, `apps/landing/pnpm-lock.yaml`) are updated if dependencies changed

## Git

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `ci:`, `test:`, `refactor:`.
- Never commit `.env` files, secrets, `.venv/` or `node_modules/`.
- Don't push or force-push unless explicitly asked.