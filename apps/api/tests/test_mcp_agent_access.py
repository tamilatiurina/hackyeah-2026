"""FR-17: which MCP servers and tools each agent may use; editing a registered server."""

from app.main import app
from fastapi.testclient import TestClient

client = TestClient(app)
SERVERS = "/api/v1/mcp-servers"
AGENT = "7b4eb987-4315-4745-83c7-258061f2f2c4"
OTHER_AGENT = "0b9a3a3e-8f39-4b55-9a5e-1d1c2b3a4f5e"


def access(agent_id: str = AGENT) -> str:
    return f"/api/v1/agents/{agent_id}/mcp-servers"


def register(name: str = "Orders", tools: list[str] | None = None) -> str:
    r = client.post(
        SERVERS,
        json={
            "name": name,
            "url": "https://mcp.acme.dev/orders",
            "auth": {"type": "api_key", "header": "X-Key", "api_key": "sk-orders-secret"},
            "allowed_tools": tools or ["get_order", "list_orders", "refund"],
        },
    )
    assert r.status_code == 201, r.text
    server_id: str = r.json()["id"]
    return server_id


# --- editing a registered server --------------------------------------------------------------


def test_edit_a_server_name_url_and_tools() -> None:
    server = register()
    r = client.patch(
        f"{SERVERS}/{server}",
        json={
            "name": "Orders v2",
            "url": "https://mcp.acme.dev/v2",
            "allowed_tools": ["get_order"],
        },
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["name"], body["url"], body["allowed_tools"]) == (
        "Orders v2",
        "https://mcp.acme.dev/v2",
        ["get_order"],
    )
    assert body["auth"]["header"] == "X-Key"  # auth not sent: kept
    assert client.get(f"{SERVERS}/{server}").json()["name"] == "Orders v2"


def test_replacing_auth_never_returns_the_secret() -> None:
    server = register()
    r = client.patch(
        f"{SERVERS}/{server}",
        json={"auth": {"type": "api_key", "header": "Authorization", "api_key": "sk-new-secret"}},
    )
    assert r.status_code == 200
    assert r.json()["auth"] == {
        "type": "api_key",
        "header": "Authorization",
        "client_id": None,
        "scopes": [],
        "has_secret": True,
    }
    assert "sk-new-secret" not in r.text


def test_edit_errors() -> None:
    server = register("Orders")
    register("Docs")
    assert client.patch(f"{SERVERS}/{server}", json={"name": "Docs"}).status_code == 409
    assert client.patch(f"{SERVERS}/mcp-nope", json={"name": "X"}).status_code == 404
    bad = client.patch(f"{SERVERS}/{server}", json={"allowed_tools": ["get order!"]})
    assert bad.status_code == 422
    assert client.patch(f"{SERVERS}/{server}", json={"allowed_tools": []}).status_code == 422


# --- per-agent access -------------------------------------------------------------------------


def test_attach_a_server_with_a_subset_of_its_tools() -> None:
    server = register()
    r = client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order", "refund"]})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "server_id": server,
        "name": "Orders",
        "url": "https://mcp.acme.dev/orders",
        "available_tools": ["get_order", "list_orders", "refund"],
        "allowed_tools": ["get_order", "refund"],
    }
    assert client.get(access()).json() == [r.json()]
    assert client.get(access(OTHER_AGENT)).json() == []


def test_changing_the_tools_replaces_the_selection() -> None:
    server = register()
    client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order"]})
    r = client.put(f"{access()}/{server}", json={"allowed_tools": ["list_orders", "refund"]})
    assert r.json()["allowed_tools"] == ["list_orders", "refund"]
    assert len(client.get(access()).json()) == 1


def test_only_the_servers_own_tools_can_be_allowed() -> None:
    server = register()
    r = client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order", "delete_db"]})
    assert r.status_code == 422
    assert "delete_db" in r.text
    assert client.put(f"{access()}/{server}", json={"allowed_tools": []}).status_code == 422
    dup = client.put(f"{access()}/{server}", json={"allowed_tools": ["refund", "refund"]})
    assert dup.status_code == 422
    assert client.get(access()).json() == []


def test_unknown_server_or_bad_agent_id() -> None:
    assert client.put(f"{access()}/mcp-nope", json={"allowed_tools": ["x"]}).status_code == 404
    assert client.get(access("not-a-uuid")).status_code == 422


def test_detach() -> None:
    server = register()
    client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order"]})
    assert client.delete(f"{access()}/{server}").status_code == 204
    assert client.get(access()).json() == []
    assert client.delete(f"{access()}/{server}").status_code == 404


def test_servers_count_the_agents_using_them() -> None:
    server = register()
    client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order"]})
    client.put(f"{access(OTHER_AGENT)}/{server}", json={"allowed_tools": ["refund"]})
    assert client.get(f"{SERVERS}/{server}").json()["agents"] == 2
    [listed] = client.get(SERVERS).json()
    assert listed["agents"] == 2


def test_removing_a_tool_from_a_server_removes_it_from_agents() -> None:
    server = register()
    client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order", "refund"]})
    client.put(f"{access(OTHER_AGENT)}/{server}", json={"allowed_tools": ["refund"]})
    client.patch(f"{SERVERS}/{server}", json={"allowed_tools": ["get_order", "list_orders"]})
    assert client.get(access()).json()[0]["allowed_tools"] == ["get_order"]
    assert client.get(access(OTHER_AGENT)).json() == []  # left with no tools: detached
    assert client.get(f"{SERVERS}/{server}").json()["agents"] == 1


def test_deleting_a_server_detaches_it() -> None:
    server = register()
    client.put(f"{access()}/{server}", json={"allowed_tools": ["get_order"]})
    assert client.delete(f"{SERVERS}/{server}").status_code == 204
    assert client.get(access()).json() == []
