import json
from pathlib import Path

from app.seeds import seed_signatures

POLICY = Path(__file__).resolve().parents[3] / "packages" / "pi-control-layer" / "policy.json"


def test_signature_seeds_match_policy_json() -> None:
    # The API deploys standalone, so it copies the signatures; this keeps the copy honest.
    patterns = json.loads(POLICY.read_text())["defaults"]["injection"]["patterns"]
    expected = [{"id": p["id"], "regex": p["regex"]} for p in patterns]
    assert [s.model_dump() for s in seed_signatures()] == expected
