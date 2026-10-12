from typing import Any
from unittest.mock import MagicMock

import pytest
from app.guardrails.repository import SupabaseGuardrailRepository, get_guardrail_repository
from app.main import app
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from tests import fakes

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


def test_queries_run_on_the_signed_in_users_client() -> None:
    user = fakes.fake_user()
    repo = get_guardrail_repository(user)
    assert isinstance(repo, SupabaseGuardrailRepository)
    query = user.client.table.return_value.select.return_value.order.return_value
    query.execute.return_value.data = []
    repo.list()
    user.client.table.assert_called_with("guardrails")


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
