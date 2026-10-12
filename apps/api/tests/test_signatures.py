from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
URL = "/api/v1/injection-signatures"
SEED_IDS = [
    "ignore-instructions",
    "system-prompt-override",
    "reveal-prompt",
    "tool-hijack",
    "exfiltrate-data",
]


def test_lists_the_users_signatures() -> None:
    assert [s["id"] for s in client.get(URL).json()] == SEED_IDS


def test_adds_a_signature() -> None:
    r = client.post(URL, json={"id": "pirate-speak", "regex": "(?i)arr matey"})
    assert r.status_code == 201
    assert r.json() == {"id": "pirate-speak", "regex": "(?i)arr matey"}
    assert [s["id"] for s in client.get(URL).json()][-1] == "pirate-speak"


def test_duplicate_id_is_409() -> None:
    r = client.post(URL, json={"id": "tool-hijack", "regex": "x"})
    assert r.status_code == 409
    assert r.json() == {"detail": "A signature with this id already exists"}


def test_invalid_id_or_regex_is_422() -> None:
    assert client.post(URL, json={"id": "Bad Id", "regex": "x"}).status_code == 422
    assert client.post(URL, json={"id": "ok-id", "regex": "(x"}).status_code == 422


def test_deletes_a_signature() -> None:
    assert client.delete(f"{URL}/tool-hijack").status_code == 204
    assert "tool-hijack" not in [s["id"] for s in client.get(URL).json()]
    r = client.delete(f"{URL}/tool-hijack")
    assert r.status_code == 404
    assert r.json() == {"detail": "Signature not found"}
