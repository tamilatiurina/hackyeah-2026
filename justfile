# Same commands as the Makefile, for just users.

supabase_dlx := "pnpm dlx supabase@2.119.0"

default:
    @just --list

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
    uv run ruff check .
    uv run ruff format --check .
    uv run mypy apps/cli packages

test:
    uv run pytest
    cd apps/api && uv run pytest

supabase:
    {{supabase_dlx}} start --workdir apps/api
    ./scripts/supabase-env.sh

supabase-stop:
    {{supabase_dlx}} stop --workdir apps/api
