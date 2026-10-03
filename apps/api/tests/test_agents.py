import asyncio
import socket
from collections.abc import AsyncIterator, Callable, Iterator
from typing import Any
from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest
from app.api.routes.agents import router as agents_router
from app.api.routes.agents.deps import (
    AgentDatabase,
    ResolvedUpstream,
    ensure_public_upstream,
    get_agent_database,
    get_http_client,
)
from app.main import app
from fastapi import HTTPException
from fastapi.testclient import TestClient
from postgrest.exceptions import APIError
from pydantic import HttpUrl

client = TestClient(app)


def _client_override(
    handler: Callable[[httpx.Request], httpx.Response],
) -> Callable[[], AsyncIterator[httpx.AsyncClient]]:
    async def override() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http_client:
            yield http_client

    return override


@pytest.fixture(autouse=True)
def reset_dependency_overrides(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    async def allow_test_upstream(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original.copy_with(host="93.184.216.34"),
            host_header=original.netloc.decode("ascii"),
            sni_hostname=original.host,
        )

    monkeypatch.setattr(agents_router, "ensure_public_upstream", allow_test_upstream)
    yield
    app.dependency_overrides.clear()


OWNER_ID = "971f4031-2dd9-4327-94c7-45323de61c67"


def _card(**overrides: Any) -> dict[str, Any]:
    card: dict[str, Any] = {
        "name": "Support Assistant",
        "description": "Answers order questions.",
        "version": "1.2.0",
        "supportedInterfaces": [
            {
                "url": "https://agent.example.com/a2a",
                "protocolBinding": "JSONRPC",
                "protocolVersion": "1.0",
            }
        ],
        "capabilities": {"streaming": False},
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            {"id": "orders", "name": "Orders", "description": "Order status.", "tags": ["support"]}
        ],
        "provider": {"organization": "Acme", "url": "https://acme.example"},
    }
    card.update(overrides)
    return card


def _serve_card(
    card: dict[str, Any] | None = None, status_code: int = 200
) -> Callable[[httpx.Request], httpx.Response]:
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.path.endswith("/.well-known/agent-card.json")
        return httpx.Response(status_code, json=card if card is not None else _card())

    return upstream


def _database() -> tuple[MagicMock, AgentDatabase]:
    database_client = MagicMock()
    return database_client, AgentDatabase(client=database_client, owner_id=OWNER_ID)


def _register(body: dict[str, Any]) -> httpx.Response:
    return client.post("/api/v1/agents", json=body)


def test_register_agent_reads_the_agent_card_and_hides_auth_value() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "93.184.216.34"
        assert request.url.path == "/support/.well-known/agent-card.json"
        assert request.headers["host"] == "agent.example.com"
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(200, json=_card())

    database_client, database = _database()
    app.dependency_overrides[get_http_client] = _client_override(upstream)
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register(
        {
            "name": "Support agent",
            "description": "Answers customer questions",
            "base_url": "https://agent.example.com/support",
            "auth_header": {"name": "Authorization", "value": "Bearer secret"},
        }
    )

    assert response.status_code == 201
    response_body = response.json()
    agent_id = response_body.pop("id")
    UUID(agent_id)
    assert response_body == {
        "name": "Support agent",
        "description": "Answers customer questions",
        "base_url": "https://agent.example.com/support",
        "upstream_url": "https://agent.example.com/a2a",
        "auth_header_name": "Authorization",
        "agent_card": _card(),
    }
    database_client.table.assert_called_once_with("agents")
    database_client.table.return_value.insert.assert_called_once_with(
        {
            "id": agent_id,
            "owner_id": OWNER_ID,
            "name": "Support agent",
            "description": "Answers customer questions",
            "base_url": "https://agent.example.com/support",
            "upstream_url": "https://agent.example.com/a2a",
            "auth_header_name": "Authorization",
            "auth_header_value": "Bearer secret",
            "agent_card": _card(),
        },
    )
    database_client.table.return_value.insert.return_value.execute.assert_called_once_with()


def test_register_agent_takes_name_and_description_from_the_card() -> None:
    _, database = _database()
    app.dependency_overrides[get_http_client] = _client_override(_serve_card())
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"base_url": "https://agent.example.com"})

    assert response.status_code == 201
    assert response.json()["name"] == "Support Assistant"
    assert response.json()["description"] == "Answers order questions."
    assert response.json()["auth_header_name"] is None


def test_register_agent_accepts_the_card_url_itself() -> None:
    _, database = _database()
    app.dependency_overrides[get_http_client] = _client_override(_serve_card())
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"base_url": "https://agent.example.com/.well-known/agent-card.json"})

    assert response.status_code == 201


@pytest.mark.parametrize(
    ("served", "status_code", "expected_detail"),
    [
        (
            _card(),
            503,
            "Could not fetch the agent's A2A Agent Card from "
            "https://offline.example.com/.well-known/agent-card.json",
        ),
        (
            {key: value for key, value in _card().items() if key != "skills"},
            200,
            "The Agent Card is invalid: skills: Field required",
        ),
        (
            _card(
                supportedInterfaces=[
                    {
                        "url": "https://agent.example.com/a2a",
                        "protocolBinding": "JSONRPC",
                        "protocolVersion": "0.3",
                    },
                    {
                        "url": "https://agent.example.com/grpc",
                        "protocolBinding": "GRPC",
                        "protocolVersion": "1.0",
                    },
                ]
            ),
            200,
            "The Agent Card has no A2A 1.0 JSON-RPC interface",
        ),
    ],
)
def test_register_agent_rejects_a_missing_or_unusable_card(
    served: dict[str, Any], status_code: int, expected_detail: str
) -> None:
    database_client, database = _database()
    app.dependency_overrides[get_http_client] = _client_override(_serve_card(served, status_code))
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"name": "Offline agent", "base_url": "https://offline.example.com"})

    assert response.status_code == 502
    assert response.json() == {"detail": expected_detail}
    database_client.table.assert_not_called()


def test_register_agent_rejects_a_private_json_rpc_endpoint(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def only_card_host_is_public(url: HttpUrl) -> ResolvedUpstream:
        if url.host == "10.0.0.5":
            raise HTTPException(status_code=422, detail="private")
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original.copy_with(host="93.184.216.34"),
            host_header=original.netloc.decode("ascii"),
            sni_hostname=original.host,
        )

    monkeypatch.setattr(agents_router, "ensure_public_upstream", only_card_host_is_public)
    card = _card(
        supportedInterfaces=[
            {"url": "http://10.0.0.5/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0"}
        ]
    )
    database_client, database = _database()
    app.dependency_overrides[get_http_client] = _client_override(_serve_card(card))
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"base_url": "https://agent.example.com"})

    assert response.status_code == 502
    assert response.json() == {
        "detail": "The Agent Card's JSON-RPC endpoint must resolve only to public IP addresses"
    }
    database_client.table.assert_not_called()


@pytest.mark.parametrize(
    ("database_code", "expected_status", "expected_detail"),
    [
        ("23505", 409, "An agent with this name already exists"),
        ("23514", 422, "Agent data violates database constraints"),
    ],
)
def test_register_agent_maps_database_input_errors(
    database_code: str,
    expected_status: int,
    expected_detail: str,
) -> None:
    database_client, database = _database()
    database_client.table.return_value.insert.return_value.execute.side_effect = APIError(
        {"code": database_code, "message": "constraint violation"}
    )
    app.dependency_overrides[get_http_client] = _client_override(_serve_card())
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"name": "Support agent", "base_url": "https://agent.example.com"})

    assert response.status_code == expected_status
    assert response.json() == {"detail": expected_detail}


@pytest.mark.parametrize(
    ("header_name", "header_value"),
    [
        ("Invalid Header", "secret"),
        ("Host", "internal.example"),
        ("Authorization", "Bearer secret\r\nX-Injected: true"),
        ("Authorization", "Bearer żółć"),
    ],
)
def test_register_agent_rejects_invalid_auth_headers(
    header_name: str,
    header_value: str,
) -> None:
    database_client, database = _database()
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register(
        {
            "name": "Support agent",
            "base_url": "https://agent.example.com",
            "auth_header": {"name": header_name, "value": header_value},
        }
    )

    assert response.status_code == 422
    database_client.table.assert_not_called()


def test_register_agent_requires_a_base_url() -> None:
    database_client, database = _database()
    app.dependency_overrides[get_agent_database] = lambda: database

    response = _register({"name": "Old client", "upstream_url": "https://agent.example.com"})

    assert response.status_code == 422  # base_url is required
    database_client.table.assert_not_called()


_STORED_ROW = {
    "id": "7b4eb987-4315-4745-83c7-258061f2f2c4",
    "name": "Support agent",
    "description": "Answers customer questions",
    "base_url": "https://agent.example.com/",
    "upstream_url": "https://agent.example.com/a2a",
    "auth_header_name": "Authorization",
    "agent_card": _card(),
}


def test_list_agents_never_returns_auth_header_value() -> None:
    database_client, database = _database()
    query = database_client.table.return_value.select.return_value.order.return_value
    query.execute.return_value.data = [{**_STORED_ROW, "auth_header_value": "must-not-leak"}]
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents")

    assert response.status_code == 200
    assert response.json() == {"data": [_STORED_ROW], "total": 1}


def test_list_agents_returns_agents_registered_before_a2a() -> None:
    database_client, database = _database()
    query = database_client.table.return_value.select.return_value.order.return_value
    query.execute.return_value.data = [{**_STORED_ROW, "agent_card": None}]
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents")

    assert response.status_code == 200
    assert response.json()["data"][0]["agent_card"] is None


def test_get_agent_returns_details() -> None:
    database_client, database = _database()
    query = (
        database_client.table.return_value.select.return_value.eq.return_value.limit.return_value
    )
    query.execute.return_value.data = [{**_STORED_ROW, "auth_header_name": None}]
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents/7b4eb987-4315-4745-83c7-258061f2f2c4")

    assert response.status_code == 200
    assert response.json()["name"] == "Support agent"
    assert response.json()["agent_card"]["version"] == "1.2.0"
    assert "auth_header_value" not in response.json()


def test_get_agent_returns_404_for_unknown_uuid() -> None:
    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    query = (
        database_client.table.return_value.select.return_value.eq.return_value.limit.return_value
    )
    query.execute.return_value.data = []
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents/9a187723-ae8c-45e7-968c-08c03a81434e")

    assert response.status_code == 404
    assert response.json() == {"detail": "Agent not found"}


def test_list_agents_returns_503_on_database_error() -> None:
    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    query = database_client.table.return_value.select.return_value.order.return_value
    query.execute.side_effect = httpx.ConnectError("database unavailable")
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents")

    assert response.status_code == 503
    assert response.json() == {"detail": "Could not read agents"}


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1:8000",
        "http://10.0.0.1",
        "http://169.254.169.254/latest/meta-data",
        "http://[::1]",
    ],
)
def test_private_upstream_addresses_are_rejected(url: str) -> None:
    with pytest.raises(HTTPException) as error:
        asyncio.run(ensure_public_upstream(HttpUrl(url)))

    assert error.value.status_code == 422
    assert error.value.detail == "Upstream URL must resolve only to public IP addresses"


def test_public_upstream_is_pinned_to_validated_address(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    records = [
        (
            socket.AF_INET,
            socket.SOCK_STREAM,
            socket.IPPROTO_TCP,
            "",
            ("93.184.216.34", 443),
        )
    ]
    monkeypatch.setattr(socket, "getaddrinfo", lambda *_args, **_kwargs: records)

    resolved = asyncio.run(ensure_public_upstream(HttpUrl("https://agent.example.com/health")))

    assert resolved.url == httpx.URL("https://93.184.216.34/health")
    assert resolved.host_header == "agent.example.com"
    assert resolved.sni_hostname == "agent.example.com"
