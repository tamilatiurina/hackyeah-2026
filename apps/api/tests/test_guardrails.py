from typing import Any

import httpx
from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
BASE = "/api/v1"

SEED_IDS = [
    "gr-pii",
    "gr-injection",
    "gr-toxicity",
    "gr-topic",
    "gr-leak",
    "gr-competitors",
    "gr-length",
]


def create(**overrides: Any) -> httpx.Response:
    body: dict[str, Any] = {
        "name": "PII",
        "engine": "library",
        "stages": ["input"],
        "action": "redact",
        "config": {"template": "pii"},
    }
    body.update(overrides)
    return client.post(f"{BASE}/guardrails", json=body)


def test_templates_list_their_engines() -> None:
    templates = {t["id"]: t for t in client.get(f"{BASE}/guardrail-templates").json()}
    assert templates["pii"]["engines"] == ["library"]
    assert templates["pii"]["entities"] == ["EMAIL", "PHONE", "CREDIT_CARD", "IBAN"]
    assert templates["toxicity"]["engines"] == ["moderation", "llm_judge"]
    assert templates["topic"]["engines"] == ["llm_judge"]
    assert "engine" not in templates["pii"]


def test_create_keeps_the_chosen_engine() -> None:
    r = create()
    assert r.status_code == 201
    body = r.json()
    assert body["engine"] == "library"
    assert body["enabled"] is True
    assert body["description"] is None
    assert body["id"].startswith("gr-")


def test_create_requires_an_engine() -> None:
    body = {"name": "PII", "stages": ["input"], "action": "redact", "config": {"template": "pii"}}
    r = client.post(f"{BASE}/guardrails", json=body)
    assert r.status_code == 422


def test_engine_must_suit_the_template() -> None:
    r = create(engine="regex", action="block", config={"template": "toxicity"})
    assert r.status_code == 422
    assert (
        "engine 'regex' not allowed for template 'toxicity' (allowed: moderation, llm_judge)"
        in r.text
    )


def test_redact_not_allowed_for_toxicity() -> None:
    r = create(engine="moderation", action="redact", config={"template": "toxicity"})
    assert r.status_code == 422


def test_bad_regex_rejected() -> None:
    r = create(engine="regex", action="block", config={"template": "regex", "pattern": "(x"})
    assert r.status_code == 422


def test_description_round_trips_and_is_limited() -> None:
    assert create(description="Masks emails").json()["description"] == "Masks emails"
    assert create(description="x" * 201).status_code == 422


def test_list_starts_with_the_seed_guardrails() -> None:
    created = create(name="Mine").json()
    ids = [g["id"] for g in client.get(f"{BASE}/guardrails").json()]
    assert ids == [*SEED_IDS, created["id"]]


def test_seed_guardrails_resolve_engines() -> None:
    by_id = {g["id"]: g for g in client.get(f"{BASE}/guardrails").json()}
    assert by_id["gr-pii"]["engine"] == "library"
    assert by_id["gr-toxicity"]["stages"] == ["input", "output"]
    assert by_id["gr-competitors"]["action"] == "warn"


def test_get_one_and_unknown() -> None:
    assert client.get(f"{BASE}/guardrails/gr-pii").json()["name"] == "PII redaction"
    r = client.get(f"{BASE}/guardrails/nope")
    assert r.status_code == 404
    assert r.json() == {"detail": "Guardrail not found"}


def test_patch_changes_only_the_fields_sent() -> None:
    admin = {"X-Role": "admin"}
    r = client.patch(f"{BASE}/guardrails/gr-pii", json={"enabled": False}, headers=admin)
    assert r.status_code == 200
    assert r.json()["enabled"] is False
    assert r.json()["name"] == "PII redaction"
    cleared = client.patch(
        f"{BASE}/guardrails/gr-pii", json={"description": None}, headers=admin
    ).json()
    assert cleared["description"] is None
    assert cleared["enabled"] is False


def test_patch_rejects_null_name_or_enabled() -> None:
    assert client.patch(f"{BASE}/guardrails/gr-pii", json={"name": None}).status_code == 422
    assert client.patch(f"{BASE}/guardrails/gr-pii", json={"enabled": None}).status_code == 422
    assert client.patch(f"{BASE}/guardrails/gr-pii", json={"name": ""}).status_code == 422


def test_patch_unknown_is_404() -> None:
    assert client.patch(f"{BASE}/guardrails/nope", json={"enabled": False}).status_code == 404


def test_delete_then_gone() -> None:
    admin = {"X-Role": "admin"}
    assert client.delete(f"{BASE}/guardrails/gr-pii", headers=admin).status_code == 204
    assert client.get(f"{BASE}/guardrails/gr-pii").status_code == 404
    assert client.delete(f"{BASE}/guardrails/gr-pii").status_code == 404


def test_each_test_starts_from_the_seeds() -> None:
    assert len(client.get(f"{BASE}/guardrails").json()) == len(SEED_IDS)
