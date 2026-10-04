import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.audit.memory import reset_in_memory_audit  # noqa: E402  (needs the path above)
from app.core.config import settings  # noqa: E402  (needs the path above)
from app.mcp.repository import reset_in_memory_servers  # noqa: E402  (needs the path above)
from app.store import reset_store  # noqa: E402  (needs the path above)


@pytest.fixture(autouse=True)
def fresh_store() -> None:
    reset_store()
    reset_in_memory_servers()
    reset_in_memory_audit()


@pytest.fixture(autouse=True)
def no_real_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    # apps/api/.env may hold a real Supabase project; tests must never touch that database.
    # Without these settings, guardrails and MCP servers use memory. Tests that need them set them.
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "")


@pytest.fixture(autouse=True)
def no_real_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    # apps/api/.env may hold a real Anthropic key; tests must never call the model.
    # Without it, llm_judge verdicts are the simulated heuristics. Tests inject a fake judge.
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
