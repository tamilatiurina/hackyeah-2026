from typing import Any
from unittest.mock import MagicMock

import pytest
from app.core import supabase as supabase_module
from app.core.config import settings
from app.guardrails.repository import (
    InMemoryGuardrailRepository,
    SupabaseGuardrailRepository,
    get_guardrail_repository,
)
from app.main import app
from app.seed_db import seed_guardrails_table
from app.seeds import seed_guardrails
from fastapi import HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError

client = TestClient(app)
BASE = "/api/v1/guardrails"

PII_ROW: dict[str, Any] = {
    "id": "gr-pii",
    "name": "PII redaction",
    "description": "Masks emails.",
    "engine": "library",
    "stages": ["output"],
    "action": "redact",
    "config": {"template": "pii", "entities": ["EMAIL"]},
    "enabled": True,
    "is_mandatory": False,
}


@pytest.fixture
def db() -> Any:
    database = MagicMock()
    app.dependency_overrides[get_guardrail_repository] = lambda: SupabaseGuardrailRepository(
        database
    )
    yield database
    app.dependency_overrides.clear()


def test_without_supabase_the_in_memory_store_is_used() -> None:
    assert isinstance(get_guardrail_repository(None), InMemoryGuardrailRepository)


def _configure_supabase(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    monkeypatch.setattr(settings, "SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(settings, "SUPABASE_KEY", "sb_publishable_test")
    create = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(supabase_module, "create_client", create)
    return create


def test_with_supabase_queries_run_as_the_signed_in_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    create = _configure_supabase(monkeypatch)
    token = HTTPAuthorizationCredentials(scheme="Bearer", credentials="user-access-token")

    assert isinstance(get_guardrail_repository(token), SupabaseGuardrailRepository)
    args, kwargs = create.call_args
    assert args == ("https://example.supabase.co", "sb_publishable_test")
    assert kwargs["options"].headers == {"Authorization": "Bearer user-access-token"}


def test_with_supabase_signed_out_requests_get_401(monkeypatch: pytest.MonkeyPatch) -> None:
    _configure_supabase(monkeypatch)
    r = client.get(BASE)
    assert r.status_code == 401
    assert r.json() == {"detail": "Sign in to use guardrails"}


def test_expired_token_is_401() -> None:
    database = MagicMock()
    query = database.table.return_value.select.return_value.order.return_value
    query.execute.side_effect = APIError({"code": "PGRST303", "message": "JWT expired"})
    with pytest.raises(HTTPException) as caught:
        SupabaseGuardrailRepository(database).list()
    assert caught.value.status_code == 401


def test_list_reads_rows_in_insertion_order(db: MagicMock) -> None:
    db.table.return_value.select.return_value.order.return_value.execute.return_value.data = [
        PII_ROW
    ]

    r = client.get(BASE)

    assert r.status_code == 200
    assert r.json() == [PII_ROW]
    db.table.assert_called_with("guardrails")
    db.table.return_value.select.return_value.order.assert_called_once_with("position")


def test_create_inserts_a_row(db: MagicMock) -> None:
    r = client.post(
        BASE,
        json={
            "name": "Mine",
            "engine": "regex",
            "stages": ["input"],
            "action": "block",
            "config": {"template": "regex", "pattern": "(?i)secret"},
        },
    )

    assert r.status_code == 201
    row = db.table.return_value.insert.call_args.args[0]
    assert row == r.json()
    assert row["id"].startswith("gr-")
    assert row["config"] == {
        "template": "regex",
        "pattern": "(?i)secret",
        "replacement": "[REDACTED]",
    }


def test_get_unknown_is_404(db: MagicMock) -> None:
    query = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    query.execute.return_value.data = []
    assert client.get(f"{BASE}/nope").status_code == 404


def test_patch_updates_only_the_row(db: MagicMock) -> None:
    query = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    query.execute.return_value.data = [PII_ROW]

    r = client.patch(f"{BASE}/gr-pii", json={"enabled": False})

    assert r.status_code == 200
    assert r.json()["enabled"] is False
    update = db.table.return_value.update
    assert update.call_args.args[0]["enabled"] is False
    assert "id" not in update.call_args.args[0]
    update.return_value.eq.assert_called_once_with("id", "gr-pii")


def test_delete_found_and_missing(db: MagicMock) -> None:
    # The route reads the row first: deleting a mandatory guardrail is admin-only (FR-06).
    lookup = db.table.return_value.select.return_value.eq.return_value.limit.return_value
    lookup.execute.return_value.data = [PII_ROW]
    deleted = db.table.return_value.delete.return_value.eq.return_value.execute.return_value
    deleted.data = [{"id": "gr-pii"}]
    assert client.delete(f"{BASE}/gr-pii").status_code == 204
    deleted.data = []
    assert client.delete(f"{BASE}/gr-pii").status_code == 404


def test_database_errors_map_to_http_errors() -> None:
    database = MagicMock()
    repo = SupabaseGuardrailRepository(database)
    query = database.table.return_value.select.return_value.order.return_value
    for code, expected in [("23514", 422), ("23505", 409), ("XX000", 503)]:
        query.execute.side_effect = APIError({"code": code, "message": "boom"})
        with pytest.raises(HTTPException) as caught:
            repo.list()
        assert caught.value.status_code == expected


def test_invalid_stored_row_is_503(db: MagicMock) -> None:
    db.table.return_value.select.return_value.order.return_value.execute.return_value.data = [
        PII_ROW | {"engine": "not-an-engine"}
    ]
    assert client.get(BASE).status_code == 503


def test_seed_script_skips_existing_rows() -> None:
    database = MagicMock()

    count = seed_guardrails_table(database)

    assert count == len(seed_guardrails())
    database.table.assert_called_once_with("guardrails")
    rows = database.table.return_value.upsert.call_args.args[0]
    assert [row["id"] for row in rows] == [g.id for g in seed_guardrails()]
    assert database.table.return_value.upsert.call_args.kwargs == {
        "on_conflict": "id",
        "ignore_duplicates": True,
    }
