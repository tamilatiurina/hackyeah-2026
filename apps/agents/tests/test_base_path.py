"""The demo agent can live under a path prefix (BASE_PATH), e.g. /demo-agent on Vercel."""

import importlib.util
import sys
from pathlib import Path
from types import ModuleType

import pytest
from fastapi.testclient import TestClient

APP = Path(__file__).resolve().parents[1] / "app.py"


def load_agent(monkeypatch: pytest.MonkeyPatch, base_path: str) -> ModuleType:
    """A fresh copy of app.py read with these settings (they are read at import time)."""
    monkeypatch.setenv("BASE_PATH", base_path)
    monkeypatch.setenv("MOCK", "1")
    monkeypatch.delenv("PUBLIC_URL", raising=False)
    spec = importlib.util.spec_from_file_location("demo_agent_app", APP)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, "demo_agent_app", module)
    spec.loader.exec_module(module)
    return module


def send(client: TestClient, path: str) -> dict[str, object]:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "SendMessage",
        "params": {"message": {"messageId": "m-1", "role": "ROLE_USER", "parts": [{"text": "hi"}]}},
    }
    r = client.post(path, json=body, headers={"A2A-Version": "1.0"})
    assert r.status_code == 200
    result: dict[str, object] = r.json()
    return result


def test_with_a_base_path_both_routes_and_the_card_url_move(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    client = TestClient(load_agent(monkeypatch, "/demo-agent/").app, base_url="https://x.test")

    card = client.get("/demo-agent/.well-known/agent-card.json").json()

    assert card["supportedInterfaces"][0]["url"] == "https://x.test/demo-agent/a2a"
    assert "result" in send(client, "/demo-agent/a2a")
    assert client.get("/.well-known/agent-card.json").status_code == 404


def test_without_a_base_path_it_serves_at_the_root(monkeypatch: pytest.MonkeyPatch) -> None:
    client = TestClient(load_agent(monkeypatch, "").app, base_url="https://x.test")

    card = client.get("/.well-known/agent-card.json").json()

    assert card["supportedInterfaces"][0]["url"] == "https://x.test/a2a"
    assert "result" in send(client, "/a2a")
