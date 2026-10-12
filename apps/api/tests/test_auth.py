"""Every panel route runs as a signed-in Supabase user (app.core.auth.get_current_user)."""

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest
from app.core import supabase as supabase_module
from app.core.auth import get_current_user
from app.core.config import settings
from app.main import app
from fastapi.testclient import TestClient
from supabase_auth.errors import AuthApiError

client = TestClient(app)
GUARDRAILS = "/api/v1/guardrails"
TOKEN = {"Authorization": "Bearer user-access-token"}


@pytest.fixture
def supabase(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """Real get_current_user against a fake Supabase client."""
    app.dependency_overrides.pop(get_current_user)
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "sb_publishable_test")
    database = MagicMock()
    monkeypatch.setattr(supabase_module, "create_client", MagicMock(return_value=database))
    return database


def _user(**fields: Any) -> SimpleNamespace:
    """What supabase.auth.get_user answers for a valid token."""
    user = {"id": "u-1", "email": "me@example.com", "is_anonymous": False} | fields
    return SimpleNamespace(user=SimpleNamespace(**user))


def test_no_token_is_401(supabase: MagicMock) -> None:
    r = client.get(GUARDRAILS)
    assert r.status_code == 401
    assert r.json() == {"detail": "Sign in to continue"}
    assert r.headers["www-authenticate"] == "Bearer"


def test_a_valid_token_runs_as_that_user(supabase: MagicMock) -> None:
    supabase.auth.get_user.return_value = _user()
    r = client.get(GUARDRAILS, headers=TOKEN)
    assert r.status_code == 200
    supabase.auth.get_user.assert_called_once_with("user-access-token")
    args, kwargs = supabase_module.create_client.call_args  # type: ignore[attr-defined]
    assert args == ("https://example.supabase.co", "sb_publishable_test")
    assert kwargs["options"].headers == {"Authorization": "Bearer user-access-token"}


def test_an_invalid_token_is_401(supabase: MagicMock) -> None:
    supabase.auth.get_user.side_effect = AuthApiError("invalid JWT", 401, None)
    r = client.get(GUARDRAILS, headers=TOKEN)
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid or expired access token"}


def test_anonymous_sessions_are_not_accounts(supabase: MagicMock) -> None:
    supabase.auth.get_user.return_value = _user(is_anonymous=True)
    assert client.get(GUARDRAILS, headers=TOKEN).status_code == 401


def test_without_supabase_the_api_is_unavailable() -> None:
    app.dependency_overrides.pop(get_current_user)
    r = client.get(GUARDRAILS, headers=TOKEN)
    assert r.status_code == 503


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/guardrail-templates",
        "/api/v1/injection-signatures",
        "/api/v1/agents",
        "/api/v1/mcp-servers",
        "/api/v1/audit-events",
    ],
)
def test_every_panel_route_needs_a_user(supabase: MagicMock, path: str) -> None:
    assert client.get(path).status_code == 401


def test_dry_run_needs_a_user(supabase: MagicMock) -> None:
    r = client.post(
        "/api/v1/guardrails/dry-run",
        json={
            "engine": "regex",
            "stages": ["input"],
            "action": "block",
            "config": {"template": "regex", "pattern": "x"},
            "text": "x",
        },
    )
    assert r.status_code == 401
