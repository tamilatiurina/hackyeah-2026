"""Settings read the Supabase key under the names the Vercel Supabase integration syncs."""

import pytest
from app.core.config import Settings

_KEY_NAMES = ("SUPABASE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY")


@pytest.fixture(autouse=True)
def clean_supabase_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for name in ("SUPABASE_URL", *_KEY_NAMES, "SUPABASE_SERVICE_ROLE_KEY"):
        monkeypatch.delenv(name, raising=False)


def _settings() -> Settings:
    return Settings(_env_file=None)


@pytest.mark.parametrize("name", ["SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"])
def test_reads_the_key_synced_by_the_vercel_integration(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    monkeypatch.setenv("SUPABASE_URL", "https://abc.supabase.co")
    monkeypatch.setenv(name, "synced-key")
    settings = _settings()
    assert settings.SUPABASE_URL == "https://abc.supabase.co"
    assert settings.SUPABASE_KEY == "synced-key"


def test_explicit_supabase_key_wins_over_synced_ones(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_KEY", "explicit")
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert _settings().SUPABASE_KEY == "explicit"


def test_publishable_key_wins_over_legacy_anon_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_PUBLISHABLE_KEY", "publishable")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert _settings().SUPABASE_KEY == "publishable"


def test_empty_supabase_key_falls_through_to_synced_one(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_KEY", "")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    assert _settings().SUPABASE_KEY == "anon"


def test_never_falls_back_to_the_service_role_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    assert _settings().SUPABASE_KEY == ""
