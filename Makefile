.PHONY: install api web landing cli test-agent lint test test-db supabase supabase-stop

SUPABASE = pnpm dlx supabase@2.119.0

install:
	uv sync --all-packages
	cd apps/api && uv sync
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

lint:
	uv run ruff check . && uv run ruff format --check . && uv run mypy apps/cli packages

test:
	uv run pytest
	cd apps/api && uv run pytest

supabase:
	$(SUPABASE) start --workdir apps/api
	./scripts/supabase-env.sh

# RLS and ownership tests (apps/api/supabase/tests) against the running local Supabase.
test-db:
	$(SUPABASE) test db --workdir apps/api

supabase-stop:
	$(SUPABASE) stop --workdir apps/api
