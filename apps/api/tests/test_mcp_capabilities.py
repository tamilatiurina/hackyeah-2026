import time

import cryptography.fernet
import pytest
from app.core.config import settings
from app.mcp.capabilities import (
    CapabilityInvalidError,
    capability_server,
    issue_capability,
    issue_receipt,
    read_capability,
    verify_receipts,
)
from app.mcp.models import McpGrant
from cryptography.fernet import Fernet


def grant() -> McpGrant:
    return McpGrant(
        id="mcp-orders",
        name="Orders",
        url="https://mcp.example.com/mcp",
        allowedTools=["get_order"],
        authType="none",
    )


def test_capability_is_opaque_and_round_trips(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())

    token = issue_capability("agent-1", "call-1", grant())
    opened = read_capability(token)

    assert "mcp.example.com" not in token
    assert opened.server_id == "mcp-orders"
    assert opened.allowed_tools == ["get_order"]


def test_only_matching_receipts_enter_the_trace(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())
    capability = read_capability(issue_capability("agent-1", "call-1", grant()))
    receipt = issue_receipt(capability, "get_order", "allowed", 12.345)

    assert verify_receipts([receipt, receipt, "tampered"], "agent-1", "call-1")[0].model_dump() == {
        "serverId": "mcp-orders",
        "serverName": "Orders",
        "toolName": "get_order",
        "status": "allowed",
        "latencyMs": 12.35,
    }
    assert verify_receipts([receipt], "agent-2", "call-1") == []
    assert verify_receipts([receipt], "agent-1", "call-2") == []


def test_agent_receives_only_the_proxy_location(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())

    server = capability_server(
        grant(), agent_id="agent-1", call_id="call-1", proxy_url="https://hub.example/mcp-proxy/"
    )

    assert server["url"] == "https://hub.example/mcp-proxy/"
    assert "mcp.example.com" not in str(server)


def test_changed_and_expired_capabilities_are_rejected(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "CALL_TIMEOUT_SECONDS", 1)
    issued_at = time.time()
    token = issue_capability("agent-1", "call-1", grant())

    with pytest.raises(CapabilityInvalidError):
        read_capability(token[:-1] + ("A" if token[-1] != "A" else "B"))

    monkeypatch.setattr(cryptography.fernet.time, "time", lambda: issued_at + 32)
    with pytest.raises(CapabilityInvalidError):
        read_capability(token)


def test_capability_is_bound_to_one_agent_call_and_server(monkeypatch) -> None:
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())

    opened = read_capability(issue_capability("agent-1", "call-7", grant()))

    assert (opened.agent_id, opened.call_id, opened.server_id) == (
        "agent-1",
        "call-7",
        "mcp-orders",
    )
