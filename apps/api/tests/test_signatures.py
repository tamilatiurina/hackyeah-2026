from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
URL = "/api/v1/injection-signatures"
ADMIN = {"X-Role": "admin"}
DEV = {"X-Role": "dev"}
SEED_IDS = [
    "ignore-instructions",
    "system-prompt-override",
    "reveal-prompt",
    "tool-hijack",
    "exfiltrate-data",
]


def test_lists_the_company_signatures() -> None:
    assert [s["id"] for s in client.get(URL).json()] == SEED_IDS


def test_admin_adds_a_signature() -> None:
    r = client.post(URL, json={"id": "pirate-speak", "regex": "(?i)arr matey"}, headers=ADMIN)
    assert r.status_code == 201
    assert r.json() == {"id": "pirate-speak", "regex": "(?i)arr matey"}
    assert [s["id"] for s in client.get(URL).json()][-1] == "pirate-speak"


def test_developers_and_anonymous_callers_cannot_add() -> None:
    body = {"id": "pirate-speak", "regex": "(?i)arr matey"}
    for headers in (DEV, {}):
        r = client.post(URL, json=body, headers=headers)
        assert r.status_code == 403
        assert r.json() == {"detail": "Only admins can change injection signatures"}


def test_admin_check_runs_before_body_validation() -> None:
    r = client.post(URL, json={"id": "Bad Id", "regex": "("}, headers=DEV)
    assert r.status_code == 403


def test_duplicate_id_is_409() -> None:
    r = client.post(URL, json={"id": "tool-hijack", "regex": "x"}, headers=ADMIN)
    assert r.status_code == 409
    assert r.json() == {"detail": "A signature with this id already exists"}


def test_invalid_id_or_regex_is_422() -> None:
    assert client.post(URL, json={"id": "Bad Id", "regex": "x"}, headers=ADMIN).status_code == 422
    assert client.post(URL, json={"id": "ok-id", "regex": "(x"}, headers=ADMIN).status_code == 422


def test_admin_deletes_a_signature() -> None:
    assert client.delete(f"{URL}/tool-hijack", headers=ADMIN).status_code == 204
    assert "tool-hijack" not in [s["id"] for s in client.get(URL).json()]
    r = client.delete(f"{URL}/tool-hijack", headers=ADMIN)
    assert r.status_code == 404
    assert r.json() == {"detail": "Signature not found"}


def test_developers_cannot_delete() -> None:
    assert client.delete(f"{URL}/tool-hijack", headers=DEV).status_code == 403
