# hackyeah-2026

Monorepo for the HackYeah 2026 project. The repo contains three applications and shared Python code:

| Path            | What it is                       | Tooling                |
| --------------- | -------------------------------- | ---------------------- |
| `apps/api`      | Backend API (FastAPI)            | Python, uv workspace   |
| `apps/cli`      | Command-line tool (Typer)        | Python, uv workspace   |
| `apps/web`      | Frontend UI (React + Vite + TS)  | Node, pnpm             |
| `apps/landing`  | Marketing landing page (Astro)   | Node, pnpm             |
| `apps/agents`   | Demo A2A agents (LLM or mock)    | Python, standalone     |
| `apps/test-agent` | Deterministic A2A test agent | Python, uv workspace   |
| `packages/core` | Shared Python code for API & CLI | Python, uv workspace   |

Every agent speaks [A2A 1.0](https://a2a-protocol.org/v1.0.0/specification/); the hub's profile is in [`docs/agent-contract-a2a.md`](docs/agent-contract-a2a.md).

All Python code lives in a single [uv](https://docs.astral.sh/uv/) workspace with **one `uv.lock`** and **one `.venv`** at the repo root. The web app and the landing page are separate pnpm projects inside `apps/web` and `apps/landing`.

```
hackyeah-2026/
├── apps/
│   ├── api/            # FastAPI service
│   ├── cli/            # Typer CLI
│   └── web/            # React + Vite UI
├── packages/
│   └── core/           # shared Python library
├── .github/workflows/  # CI
├── .vscode/            # shared editor settings
├── Makefile            # common dev commands
├── pyproject.toml      # uv workspace root + tool config (ruff, mypy, pytest)
└── uv.lock             # Python lockfile (commit it!)
```

---

## Prerequisites

Install these once on your machine (Linux / macOS / WSL):

| Tool        | Version | Install                                                        |
| ----------- | ------- | -------------------------------------------------------------- |
| git         | any     | `sudo apt install git`                                         |
| uv          | latest  | `curl -LsSf https://astral.sh/uv/install.sh \| sh`             |
| Node.js     | 22+     | via [nvm](https://github.com/nvm-sh/nvm): `nvm install 22`     |
| pnpm        | 12.8.1  | `corepack enable` (version is pinned in `apps/web/package.json`) |
| make        | any     | `sudo apt install make`                                        |

You do **not** need to install Python yourself — uv downloads the version pinned in `.python-version` (3.12) automatically.

---

## First-time setup

```bash
git clone <repo-url>
cd hackyeah-2026

make install                 # installs all Python + web dependencies
uv run pre-commit install    # runs ruff automatically on every commit
```

Then open the repo root in VS Code and install the recommended extensions when prompted. If VS Code doesn't pick up the Python interpreter, run **Python: Select Interpreter** and choose `./.venv`.

---

## Running things

All `make` commands are run from the **repo root**.

| Command     | What it does                                   | URL                          |
| ----------- | ---------------------------------------------- | ---------------------------- |
| `make api`  | Starts the API with auto-reload on port 8000   | http://localhost:8000/docs   |
| `make web`  | Starts the Vite dev server                     | http://localhost:5173        |
| `make landing` | Starts the Astro landing page (static). Set `PUBLIC_APP_URL` to change where "Open the app" points | http://localhost:4321 |
| `make cli`  | Shows the CLI help                             | —                            |
| `make lint` | Ruff lint + format check + mypy                | —                            |
| `make test` | Runs pytest across all Python packages         | —                            |
| `make supabase` | Starts local Supabase and writes env files | http://127.0.0.1:54323 (Studio) |

Run the API and the web app in two separate terminals. During development the web app proxies every `/api/*` request to `http://localhost:8000`, so frontend code can call without any CORS setup.

### Local Supabase (agents database)

The agents API stores data in Supabase and needs a signed-in user. To run it locally you need Docker:

```bash
make supabase        # start the stack, apply apps/api/supabase/migrations, write env files, create a demo user
make supabase-stop   # stop it (data is kept in Docker volumes)
```

`make supabase` writes `apps/api/.env` and `apps/web/.env.local` (gitignored) with the local URL and publishable key, and creates `demo@guardrail.local`; its password is in `apps/api/supabase/.env.demo`. Studio runs at http://127.0.0.1:54323. Re-run `./scripts/supabase-env.sh` if you only need the env files again.

The CLI is installed as the `acme` command:

```bash
uv run acme --help
```

---

## Day-to-day workflow

### Adding Python dependencies

Always add a dependency to the **specific package** that needs it:

```bash
uv add --package acme-api  <package>     # API only
uv add --package acme-cli  <package>     # CLI only
uv add --package acme-core <package>     # shared library
uv add --dev <package>                   # dev tooling for the whole repo
```

This updates the package's `pyproject.toml` and the root `uv.lock`. **Commit both.**

### Adding web dependencies

```bash
cd apps/web
pnpm add <package>          # runtime dependency
pnpm add -D <package>       # dev dependency
```

**Commit `package.json` and `pnpm-lock.yaml` together.** CI installs with `--frozen-lockfile` and fails if they're out of sync.

### Sharing code between API and CLI

Put it in `packages/core/src/acme_core/` and import it normally:

```python
from acme_core import something
```

Both apps depend on `acme-core` as a workspace package, so changes are picked up immediately — no reinstall needed.

### Writing tests

Put tests in a `tests/` folder next to the package's `src/`, for example `apps/api/tests/test_health.py`. pytest discovers everything under `apps/` and `packages/`.

### Before you push

```bash
make lint
make test
cd apps/web && pnpm lint && pnpm build
```

If ruff complains about formatting, fix it with:

```bash
uv run ruff format .
uv run ruff check . --fix
```

---

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and pull request:

- **python** — `uv sync --locked`, ruff lint, ruff format check, mypy, pytest
- **web** — `pnpm install --frozen-lockfile`, oxlint, production build

Both jobs must be green before merging.

---

## Troubleshooting

**`Could not import module "acme_api.main"`**
The module doesn't exist or the name is wrong. Check `ls apps/api/src/` and make sure the name in the `Makefile` matches.

**CI: `uv sync --locked` fails**
`uv.lock` is out of date or wasn't committed. Run `uv lock` and commit the result.

**CI: `ERR_PNPM_FROZEN_LOCKFILE_WITH_OUTDATED_LOCKFILE`**
`package.json` changed without updating the lockfile. Run `cd apps/web && pnpm install` and commit `pnpm-lock.yaml`.

**CI: pytest exits with code 5**
No tests were collected. Make sure test files are named `test_*.py`.

**`make: *** missing separator`**
The `Makefile` has spaces instead of a tab before a command. Recipe lines must start with a real tab.

**Import errors in VS Code but code runs fine**
VS Code is using the wrong interpreter. Run **Python: Select Interpreter** and pick `./.venv`.