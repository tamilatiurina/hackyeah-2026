import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import settings  # noqa: E402  (needs the path above)
from app.main import app  # noqa: E402  (needs the path above)
from tests import fakes  # noqa: E402  (needs the path above)


@pytest.fixture(autouse=True)
def fake_storage() -> None:
    """Every route runs as one fake signed-in owner, on fresh in-memory stores (tests/fakes.py).
    Tests that need the real dependency remove its override."""
    fakes.reset()
    app.dependency_overrides.clear()
    fakes.use_fakes(app)


@pytest.fixture(autouse=True)
def no_real_supabase(monkeypatch: pytest.MonkeyPatch) -> None:
    # apps/api/.env may hold a real Supabase project; tests must never touch that database.
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "")


@pytest.fixture(autouse=True)
def no_real_judge(monkeypatch: pytest.MonkeyPatch) -> None:
    # apps/api/.env may hold a real Anthropic key; tests must never call the model.
    # Without it, llm_judge verdicts are the simulated heuristics. Tests inject a fake judge.
    monkeypatch.setattr(settings, "ANTHROPIC_API_KEY", "")
