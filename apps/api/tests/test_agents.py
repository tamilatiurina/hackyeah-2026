import asyncio
import socket
from collections.abc import AsyncIterator, Callable, Iterator
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


def test_register_agent_pings_upstream_and_hides_auth_value() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        assert request.url.host == "93.184.216.34"
        assert request.headers["host"] == "agent.example.com"
        assert request.headers["authorization"] == "Bearer secret"
        return httpx.Response(204)

    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    app.dependency_overrides[get_http_client] = _client_override(upstream)
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.post(
        "/api/v1/agents",
        json={
            "name": "Support agent",
            "description": "Answers customer questions",
            "upstream_url": "https://agent.example.com/health",
            "auth_header": {
                "name": "Authorization",
                "value": "Bearer secret",
            },
            "request_format": "json",
            "response_format": "json",
        },
    )

    assert response.status_code == 201
    response_body = response.json()
    agent_id = response_body.pop("id")
    UUID(agent_id)
    assert response_body == {
        "name": "Support agent",
        "description": "Answers customer questions",
        "upstream_url": "https://agent.example.com/health",
        "auth_header_name": "Authorization",
        "request_format": "json",
        "response_format": "json",
    }
    database_client.table.assert_called_once_with("agents")
    database_client.table.return_value.insert.assert_called_once_with(
        {
            "id": agent_id,
            "owner_id": "971f4031-2dd9-4327-94c7-45323de61c67",
            "name": "Support agent",
            "description": "Answers customer questions",
            "upstream_url": "https://agent.example.com/health",
            "auth_header_name": "Authorization",
            "auth_header_value": "Bearer secret",
            "request_format": "json",
            "response_format": "json",
        },
    )
    database_client.table.return_value.insert.return_value.execute.assert_called_once_with()


def test_register_agent_rejects_unreachable_upstream() -> None:
    def upstream(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, request=request)

    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    app.dependency_overrides[get_http_client] = _client_override(upstream)
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.post(
        "/api/v1/agents",
        json={
            "name": "Offline agent",
            "description": "",
            "upstream_url": "https://offline.example.com",
            "request_format": "text",
            "response_format": "text",
        },
    )

    assert response.status_code == 502
    assert response.json() == {
        "detail": "Upstream agent did not respond successfully",
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
    def upstream(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(204)

    database_client = MagicMock()
    database_client.table.return_value.insert.return_value.execute.side_effect = APIError(
        {"code": database_code, "message": "constraint violation"}
    )
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    app.dependency_overrides[get_http_client] = _client_override(upstream)
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.post(
        "/api/v1/agents",
        json={
            "name": "Support agent",
            "description": "",
            "upstream_url": "https://agent.example.com/health",
            "request_format": "json",
            "response_format": "json",
        },
    )

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
    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.post(
        "/api/v1/agents",
        json={
            "name": "Support agent",
            "description": "",
            "upstream_url": "https://agent.example.com/health",
            "auth_header": {"name": header_name, "value": header_value},
            "request_format": "json",
            "response_format": "json",
        },
    )

    assert response.status_code == 422
    database_client.table.assert_not_called()


def test_list_agents_never_returns_auth_header_value() -> None:
    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    query = database_client.table.return_value.select.return_value.order.return_value
    query.execute.return_value.data = [
        {
            "id": "7b4eb987-4315-4745-83c7-258061f2f2c4",
            "name": "Support agent",
            "description": "Answers customer questions",
            "upstream_url": "https://agent.example.com/health",
            "auth_header_name": "Authorization",
            "auth_header_value": "must-not-leak",
            "request_format": "json",
            "response_format": "json",
        }
    ]
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents")

    assert response.status_code == 200
    assert response.json() == {
        "data": [
            {
                "id": "7b4eb987-4315-4745-83c7-258061f2f2c4",
                "name": "Support agent",
                "description": "Answers customer questions",
                "upstream_url": "https://agent.example.com/health",
                "auth_header_name": "Authorization",
                "request_format": "json",
                "response_format": "json",
            }
        ],
        "total": 1,
    }


def test_get_agent_returns_details() -> None:
    database_client = MagicMock()
    database = AgentDatabase(
        client=database_client,
        owner_id="971f4031-2dd9-4327-94c7-45323de61c67",
    )
    query = (
        database_client.table.return_value.select.return_value.eq.return_value.limit.return_value
    )
    query.execute.return_value.data = [
        {
            "id": "7b4eb987-4315-4745-83c7-258061f2f2c4",
            "name": "Support agent",
            "description": "Answers customer questions",
            "upstream_url": "https://agent.example.com/health",
            "auth_header_name": None,
            "request_format": "json",
            "response_format": "json",
        }
    ]
    app.dependency_overrides[get_agent_database] = lambda: database

    response = client.get("/api/v1/agents/7b4eb987-4315-4745-83c7-258061f2f2c4")

    assert response.status_code == 200
    assert response.json()["name"] == "Support agent"
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
