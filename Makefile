.PHONY: install api web cli lint test supabase supabase-stop

SUPABASE = pnpm dlx supabase@2.119.0

install:
	uv sync --all-packages
	cd apps/web && pnpm install

api:
	cd apps/api && uv run uvicorn app.main:app --reload --port 8000

web:
	cd apps/web && pnpm dev

cli:
	uv run acme --help

lint:
	uv run ruff check . && uv run ruff format --check . && uv run mypy apps packages

test:
	uv run pytest

supabase:
	$(SUPABASE) start --workdir apps/api
	./scripts/supabase-env.sh

supabase-stop:
	$(SUPABASE) stop --workdir apps/api
