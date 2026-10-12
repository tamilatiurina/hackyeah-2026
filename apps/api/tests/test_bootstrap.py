"""POST /api/v1/me/bootstrap: a new account gets the seed library and the demo agent once."""

from collections.abc import AsyncIterator, Iterator
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from app.api.routes.agents import router as agents_router
from app.api.routes.agents.deps import (
    AgentDatabase,
    ResolvedUpstream,
    get_agent_database,
    get_http_client,
)
from app.core.config import settings
from app.main import app
from app.seeds import seed_guardrails, seed_signatures
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pydantic import HttpUrl
from tests import fakes

client = TestClient(app, base_url="https://enforcer.example")
URL = "/api/v1/me/bootstrap"
DEMO = "https://enforcer.example/demo-agent"
CARD: dict[str, Any] = {
    "name": "Support Assistant",
    "description": "The demo agent.",
    "version": "1.0.0",
    "supportedInterfaces": [
        {"url": f"{DEMO}/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
    ],
    "capabilities": {},
    "defaultInputModes": ["text/plain"],
    "defaultOutputModes": ["text/plain"],
    "skills": [],
}


@pytest.fixture(autouse=True)
def new_account(monkeypatch: pytest.MonkeyPatch) -> Iterator[MagicMock]:
    """A user who has just signed up: empty library, no setup steps done."""
    fakes.store.guardrails.clear()
    fakes.store.signatures.clear()
    fakes.PROFILE.clear()

    async def public(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original.copy_with(host="93.184.216.34"),
            host_header=original.netloc.decode("ascii"),
            sni_hostname=original.host,
        )

    monkeypatch.setattr(agents_router, "ensure_public_upstream", public)
    database = MagicMock()
    app.dependency_overrides[get_agent_database] = lambda: AgentDatabase(
        client=database, owner_id=fakes.OWNER_ID
    )
    serve_card(200)
    yield database


def serve_card(status_code: int, seen: list[str] | None = None) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(f"{request.headers['host']}{request.url.path}")
        return httpx.Response(status_code, json=CARD)

    async def http() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as c:
            yield c

    app.dependency_overrides[get_http_client] = http


def test_first_sign_in_seeds_the_library_and_adds_the_demo_agent(new_account: MagicMock) -> None:
    seen: list[str] = []
    serve_card(200, seen)

    r = client.post(URL)

    assert r.status_code == 200
    assert r.json() == {"library": "seeded", "demo_agent": "added"}
    assert list(fakes.store.guardrails) == [g.id for g in seed_guardrails()]
    assert list(fakes.store.signatures) == [s.id for s in seed_signatures()]
    assert seen == ["enforcer.example/demo-agent/.well-known/agent-card.json"]
    row = new_account.table.return_value.insert.call_args.args[0]
    assert row["owner_id"] == fakes.OWNER_ID
    assert row["base_url"] == DEMO
    assert row["name"] == "Support Assistant"
    assert {"bootstrapped_at", "demo_agent_added_at"} == fakes.PROFILE


def test_the_next_sign_in_changes_nothing(new_account: MagicMock) -> None:
    client.post(URL)
    fakes.store.guardrails.pop("gr-injection")  # the user deleted a seed...

    r = client.post(URL)

    assert r.json() == {"library": "already_seeded", "demo_agent": "already_added"}
    assert "gr-injection" not in fakes.store.guardrails  # ...and it stays deleted
    assert new_account.table.return_value.insert.call_count == 1


def test_an_unreachable_demo_agent_is_retried_next_time() -> None:
    serve_card(503)
    assert client.post(URL).json() == {"library": "seeded", "demo_agent": "unavailable"}
    assert {"bootstrapped_at"} == fakes.PROFILE

    serve_card(200)
    assert client.post(URL).json() == {"library": "already_seeded", "demo_agent": "added"}


def test_an_already_registered_demo_agent_is_not_added_twice(new_account: MagicMock) -> None:
    new_account.table.return_value.insert.return_value.execute.side_effect = APIError(
        {"code": "23505", "message": "duplicate key"}
    )
    assert client.post(URL).json()["demo_agent"] == "already_added"
    assert "demo_agent_added_at" in fakes.PROFILE


def test_seeding_keeps_what_the_user_already_has() -> None:
    mine = seed_guardrails()[0].model_copy(update={"name": "My edited copy"})
    fakes.store.guardrails[mine.id] = mine

    client.post(URL)

    assert fakes.store.guardrails[mine.id].name == "My edited copy"
    assert len(fakes.store.guardrails) == len(seed_guardrails())


def test_demo_agent_url_setting_wins(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "DEMO_AGENT_URL", "https://demo.example")
    seen: list[str] = []
    serve_card(200, seen)
    client.post(URL)
    assert seen == ["demo.example/.well-known/agent-card.json"]
