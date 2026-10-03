from unittest.mock import MagicMock, patch

import pytest
from app.core import supabase as supabase_module
from app.core.config import settings


def test_get_supabase_uses_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    supabase_module.get_supabase.cache_clear()
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "sb_publishable_test")
    fake = MagicMock()
    with patch("app.core.supabase.create_client", return_value=fake) as create:
        client = supabase_module.get_supabase()
    create.assert_called_once_with("https://example.supabase.co", "sb_publishable_test")
    assert client is fake
    supabase_module.get_supabase.cache_clear()


def test_get_supabase_requires_config(monkeypatch: pytest.MonkeyPatch) -> None:
    supabase_module.get_supabase.cache_clear()
    monkeypatch.setattr(settings, "SUPABASE_URL", "")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "")
    with pytest.raises(RuntimeError, match="SUPABASE_URL and SUPABASE_KEY"):
        supabase_module.get_supabase()
    supabase_module.get_supabase.cache_clear()
