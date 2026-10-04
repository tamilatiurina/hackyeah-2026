.PHONY: install api web landing cli test-agent lint test supabase supabase-stop seed-sandbox

SUPABASE = pnpm dlx supabase@2.119.0

install:
	uv sync --all-packages
	cd apps/web && pnpm install
	cd apps/landing && pnpm install

api:
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000

web:
	cd apps/web && pnpm dev

landing:
	cd apps/landing && pnpm dev

cli:
	uv run acme --help

test-agent:
	uv run acme-test-agent

seed-sandbox:
	cd apps/api && uv run python -m app.pi_policy.playground

lint:
	uv run ruff check . && uv run ruff format --check . && uv run mypy apps/cli packages

test:
	uv run pytest

supabase:
	$(SUPABASE) start --workdir apps/api
	./scripts/supabase-env.sh

supabase-stop:
	$(SUPABASE) stop --workdir apps/api
