import json
import shutil
import threading
from pathlib import Path

import pytest
from app.core.config import settings
from app.main import app
from app.pi_policy.service import get_policy_service
from fastapi.testclient import TestClient

client = TestClient(app)
BASE = "/api/v1/pi/policy"

REPO_ROOT = Path(__file__).resolve().parents[3]
# CI never has the gitignored live policy, so tests read the tracked seed policy.
EXAMPLE_POLICY = REPO_ROOT / "packages" / "pi-control-layer" / "policy.json.example"
SCHEMA_PATH = REPO_ROOT / "packages" / "pi-control-layer" / "policy.schema.json"


@pytest.fixture()
def policy_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Isolated policy dir; binds the service dependency to a temp policy file."""
    policy_path = tmp_path / "policy.json"
    shutil.copy(EXAMPLE_POLICY, policy_path)
    backup_dir = policy_path.parent / "policy-backups"
    backup_dir.mkdir()
    from app.pi_policy.service import PolicyFileService

    service = PolicyFileService(path=policy_path, schema_path=SCHEMA_PATH, max_backups=10)
    app.dependency_overrides[get_policy_service] = lambda: service
    yield tmp_path
    app.dependency_overrides.pop(get_policy_service, None)


def test_get_policy_returns_document_and_meta(policy_dir: Path) -> None:
    res = client.get(BASE)
    assert res.status_code == 200
    body = res.json()
    assert body["policy"]["version"] == 1
    assert body["path"].endswith("policy.json")
    assert body["lastModifiedUtc"] is not None
    assert len(body["sha256"]) == 64
    assert body["sizeBytes"] > 0
    assert res.headers["ETag"] == f'"{body["sha256"]}"'


def test_get_policy_404_when_missing(policy_dir: Path) -> None:
    (policy_dir / "policy.json").unlink()
    res = client.get(BASE)
    assert res.status_code == 404


def test_put_policy_writes_file(policy_dir: Path) -> None:
    current = client.get(BASE).json()
    current["policy"]["defaults"]["budget"]["maxSessionCostUsd"] = 5.0
    res = client.put(BASE, json={"policy": current["policy"]})
    assert res.status_code == 200
    on_disk = json.loads((policy_dir / "policy.json").read_text())
    assert on_disk["defaults"]["budget"]["maxSessionCostUsd"] == 5.0
    # re-read reflects the change
    assert client.get(BASE).json()["policy"]["defaults"]["budget"]["maxSessionCostUsd"] == 5.0


def test_put_invalid_policy_is_rejected_and_file_untouched(policy_dir: Path) -> None:
    before = (policy_dir / "policy.json").read_text()
    current = client.get(BASE).json()
    current["policy"]["version"] = 99  # schema pins version to const 1
    res = client.put(BASE, json={"policy": current["policy"]})
    assert res.status_code == 422
    errors = res.json()["detail"]["errors"]
    assert any("version" in e["jsonPath"] for e in errors)
    assert (policy_dir / "policy.json").read_text() == before


def test_put_with_stale_if_match_fails(policy_dir: Path) -> None:
    first = client.get(BASE)
    etag = first.headers["ETag"]
    # someone else writes in between
    other = first.json()["policy"]
    other["defaults"]["budget"]["maxSessionCostUsd"] = 9.0
    client.put(BASE, json={"policy": other})
    # our stale copy must be refused
    stale = first.json()["policy"]
    stale["defaults"]["budget"]["maxSessionCostUsd"] = 7.0
    res = client.put(BASE, json={"policy": stale}, headers={"If-Match": etag})
    assert res.status_code == 412
    on_disk = json.loads((policy_dir / "policy.json").read_text())
    assert on_disk["defaults"]["budget"]["maxSessionCostUsd"] == 9.0


def test_put_with_current_if_match_succeeds(policy_dir: Path) -> None:
    first = client.get(BASE)
    policy = first.json()["policy"]
    policy["defaults"]["budget"]["maxSessionCostUsd"] = 3.0
    res = client.put(BASE, json={"policy": policy}, headers={"If-Match": first.headers["ETag"]})
    assert res.status_code == 200


def test_validate_does_not_write(policy_dir: Path) -> None:
    before = (policy_dir / "policy.json").read_text()
    policy = client.get(BASE).json()["policy"]
    policy["version"] = 2
    res = client.post(f"{BASE}/validate", json={"policy": policy})
    assert res.status_code == 200
    assert res.json()["valid"] is False
    assert len(res.json()["errors"]) >= 1
    assert (policy_dir / "policy.json").read_text() == before


def test_validate_accepts_valid_document(policy_dir: Path) -> None:
    policy = client.get(BASE).json()["policy"]
    res = client.post(f"{BASE}/validate", json={"policy": policy})
    assert res.json() == {"valid": True, "errors": []}


def test_schema_endpoint_serves_the_control_layer_schema(policy_dir: Path) -> None:
    schema = client.get(f"{BASE}/schema").json()
    assert schema["$id"].endswith("policy.schema.json")
    assert schema["definitions"]["agentPolicy"]["properties"]["identity"] is not None


def test_backup_created_on_save_and_restore_works(policy_dir: Path) -> None:
    policy = client.get(BASE).json()["policy"]
    original_owner = policy["defaults"]["budget"]["maxSessionCostUsd"]
    policy["defaults"]["budget"]["maxSessionCostUsd"] = original_owner + 1
    client.put(BASE, json={"policy": policy})
    backups = client.get(f"{BASE}/backups").json()
    assert len(backups) == 1
    backup_id = backups[0]["id"]

    res = client.post(f"{BASE}/backups/{backup_id}/restore")
    assert res.status_code == 200
    on_disk = json.loads((policy_dir / "policy.json").read_text())
    assert on_disk["defaults"]["budget"]["maxSessionCostUsd"] == original_owner


def test_restore_unknown_backup_404(policy_dir: Path) -> None:
    res = client.post(f"{BASE}/backups/20200101T000000Z/restore")
    assert res.status_code == 404


def test_restore_rejects_malformed_backup_id(policy_dir: Path) -> None:
    res = client.post(f"{BASE}/backups/..%2F..%2Fetc/restore")
    assert res.status_code in (404, 422)


def test_backup_pruning_keeps_only_max(policy_dir: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    policy = client.get(BASE).json()["policy"]
    for round_no in range(13):
        policy["defaults"]["budget"]["maxSessionCostUsd"] = round_no
        res = client.put(BASE, json={"policy": policy})
        assert res.status_code == 200
    backups = client.get(f"{BASE}/backups").json()
    assert len(backups) == settings.POLICY_MAX_BACKUPS


def test_concurrent_saves_do_not_corrupt(policy_dir: Path) -> None:
    policy = client.get(BASE).json()["policy"]
    results: list[int] = []
    barrier = threading.Barrier(4)

    def worker(n: int) -> None:
        doc = json.loads(json.dumps(policy))
        doc["defaults"]["budget"]["maxSessionCostUsd"] = n
        barrier.wait()
        res = client.put(BASE, json={"policy": doc})
        results.append(res.status_code)

    threads = [threading.Thread(target=worker, args=(i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    assert all(r == 200 for r in results)
    on_disk = json.loads((policy_dir / "policy.json").read_text())
    assert on_disk["version"] == 1  # complete, parseable document
    assert isinstance(on_disk["defaults"]["budget"]["maxSessionCostUsd"], (int, float))


def test_ui_page_is_served(policy_dir: Path) -> None:
    res = client.get(f"{BASE}/ui")
    assert res.status_code == 200
    assert "pi policy editor" in res.text
