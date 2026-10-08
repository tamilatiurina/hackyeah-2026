import asyncio

import httpx2
from app.core.config import settings
from app.mcp.capabilities import issue_capability, read_capability, verify_receipts
from app.mcp.models import McpGrant
from app.mcp.proxy import GuardrailMcpProxy, _capability, proxy_app, proxy_server
from cryptography.fernet import Fernet
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, TextContent, Tool


class Backend:
    calls: list[tuple[str, str, dict]]

    def __init__(self) -> None:
        self.calls = []

    async def list_tools(self, url: str) -> list[Tool]:
        return [
            Tool(name="get_order", description="Get an order", inputSchema={"type": "object"}),
            Tool(name="refund", description="Refund", inputSchema={"type": "object"}),
        ]

    async def call_tool(self, url: str, name: str, arguments: dict) -> CallToolResult:
        self.calls.append((url, name, arguments))
        return CallToolResult(content=[TextContent(type="text", text="shipped")])


class FailingBackend(Backend):
    async def call_tool(self, url: str, name: str, arguments: dict) -> CallToolResult:
        self.calls.append((url, name, arguments))
        raise OSError("offline")


class SlowBackend(Backend):
    async def call_tool(self, url: str, name: str, arguments: dict) -> CallToolResult:
        self.calls.append((url, name, arguments))
        await asyncio.sleep(0.05)
        return await super().call_tool(url, name, arguments)


class LargeBackend(Backend):
    async def call_tool(self, url: str, name: str, arguments: dict) -> CallToolResult:
        self.calls.append((url, name, arguments))
        return CallToolResult(content=[TextContent(type="text", text="x" * 1_000)])


def capability(monkeypatch):
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())
    grant = McpGrant(
        id="mcp-orders",
        name="Orders",
        url="https://mcp.example.com/mcp",
        allowedTools=["get_order"],
        authType="none",
    )
    return read_capability(issue_capability("agent-1", "call-1", grant))


def test_list_tools_filters_the_backend(monkeypatch) -> None:
    backend = Backend()
    proxy = GuardrailMcpProxy(backend)
    reset = _capability.set(capability(monkeypatch))
    try:
        assert [tool.name for tool in asyncio.run(proxy.list_tools())] == ["get_order"]
    finally:
        _capability.reset(reset)


def test_allowed_call_returns_a_verified_receipt(monkeypatch) -> None:
    backend = Backend()
    proxy = GuardrailMcpProxy(backend)
    reset = _capability.set(capability(monkeypatch))
    try:
        result = asyncio.run(proxy.call_tool("get_order", {"id": "48213"}))
    finally:
        _capability.reset(reset)

    receipt = result.meta["guardrailHub"]["receipt"]
    [trace] = verify_receipts([receipt], "agent-1", "call-1")
    assert trace.status == "allowed"
    assert backend.calls[0][1:] == ("get_order", {"id": "48213"})


def test_forbidden_call_never_reaches_the_backend(monkeypatch) -> None:
    backend = Backend()
    proxy = GuardrailMcpProxy(backend)
    reset = _capability.set(capability(monkeypatch))
    try:
        result = asyncio.run(proxy.call_tool("refund", {"id": "48213"}))
    finally:
        _capability.reset(reset)

    assert result.is_error
    assert backend.calls == []
    receipt = result.meta["guardrailHub"]["receipt"]
    assert verify_receipts([receipt], "agent-1", "call-1")[0].status == "blocked"


def test_backend_failure_is_safe_and_not_retried(monkeypatch) -> None:
    backend = FailingBackend()
    proxy = GuardrailMcpProxy(backend)
    reset = _capability.set(capability(monkeypatch))
    try:
        result = asyncio.run(proxy.call_tool("get_order", {}))
    finally:
        _capability.reset(reset)

    assert result.is_error
    assert len(backend.calls) == 1
    receipt = result.meta["guardrailHub"]["receipt"]
    assert verify_receipts([receipt], "agent-1", "call-1")[0].status == "error"


def test_tool_call_timeout_is_safe_and_not_retried(monkeypatch) -> None:
    backend = SlowBackend()
    proxy = GuardrailMcpProxy(backend)
    monkeypatch.setattr(settings, "MCP_TOOL_TIMEOUT_SECONDS", 0.001)
    reset = _capability.set(capability(monkeypatch))
    try:
        result = asyncio.run(proxy.call_tool("get_order", {}))
    finally:
        _capability.reset(reset)

    assert result.is_error
    assert len(backend.calls) == 1


def test_oversized_result_is_replaced_with_an_error(monkeypatch) -> None:
    backend = LargeBackend()
    proxy = GuardrailMcpProxy(backend)
    monkeypatch.setattr(settings, "MCP_MAX_RESULT_BYTES", 100)
    reset = _capability.set(capability(monkeypatch))
    try:
        result = asyncio.run(proxy.call_tool("get_order", {}))
    finally:
        _capability.reset(reset)

    assert result.is_error
    assert result.content[0].text == "MCP tool result exceeded the size limit"


def test_tools_list_is_capped_after_allowlist_filtering(monkeypatch) -> None:
    class ManyTools(Backend):
        async def list_tools(self, url: str) -> list[Tool]:
            return [
                Tool(name=f"tool_{index}", inputSchema={"type": "object"}) for index in range(5)
            ]

    grant = McpGrant(
        id="many",
        name="Many",
        url="https://mcp.example.com/mcp",
        allowedTools=[f"tool_{index}" for index in range(5)],
        authType="none",
    )
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "MCP_MAX_TOOLS", 2)
    cap = read_capability(issue_capability("agent-1", "call-1", grant))
    reset = _capability.set(cap)
    try:
        tools = asyncio.run(GuardrailMcpProxy(ManyTools()).list_tools())
    finally:
        _capability.reset(reset)

    assert [tool.name for tool in tools] == ["tool_0", "tool_1"]


def test_streamable_http_transport_enforces_the_capability(monkeypatch) -> None:
    backend = Backend()
    monkeypatch.setattr(settings, "MCP_CAPABILITY_KEY", Fernet.generate_key().decode())
    token = issue_capability(
        "agent-1",
        "call-1",
        McpGrant(
            id="mcp-orders",
            name="Orders",
            url="https://mcp.example.com/mcp",
            allowedTools=["get_order"],
            authType="none",
        ),
    )

    async def scenario() -> tuple[list[str], CallToolResult]:
        old_backend = proxy_server._backend
        proxy_server._backend = backend
        try:
            async with (
                proxy_server.session_manager.run(),
                httpx2.AsyncClient(
                    transport=httpx2.ASGITransport(app=proxy_app),
                    headers={"Authorization": f"Bearer {token}"},
                ) as http,
            ):
                transport = streamable_http_client("http://proxy/", http_client=http)
                async with Client(transport) as client:
                    listed = await client.list_tools(cache_mode="bypass")
                    called = await client.call_tool("get_order", {"id": "48213"})
                    return [tool.name for tool in listed.tools], called
        finally:
            proxy_server._backend = old_backend

    names, result = asyncio.run(scenario())

    assert names == ["get_order"]
    receipt = result.meta["guardrailHub"]["receipt"]
    assert verify_receipts([receipt], "agent-1", "call-1")[0].status == "allowed"
