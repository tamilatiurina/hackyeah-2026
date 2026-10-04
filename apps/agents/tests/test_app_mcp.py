import asyncio
from types import SimpleNamespace

import app
from mcp.types import Tool


class Block(SimpleNamespace):
    def model_dump(self, **_kwargs):
        document = {"type": self.type}
        for key in ("id", "name", "input", "text"):
            if hasattr(self, key):
                document[key] = getattr(self, key)
        return document


class Messages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    async def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def response(*blocks, input_tokens=2, output_tokens=3):
    return SimpleNamespace(
        content=list(blocks),
        usage=SimpleNamespace(input_tokens=input_tokens, output_tokens=output_tokens),
    )


def server() -> app.McpServerGrant:
    return app.McpServerGrant.model_validate(
        {
            "id": "mcp-orders",
            "name": "Orders",
            "url": "https://hub.example/mcp-proxy/",
            "transport": "streamable-http",
            "allowedTools": ["get_order"],
            "capabilityToken": "opaque",
        }
    )


def test_agent_card_declares_the_hub_mcp_extension() -> None:
    card = app.agent_card("https://agent.example/")
    assert card["capabilities"]["extensions"][0]["uri"] == app.MCP_EXTENSION_URI


def test_tool_aliases_cannot_collide_after_sanitizing() -> None:
    assert app._alias("server.a", "get_order") != app._alias("server_a", "get_order")
    assert app._alias("server", "tool.a") != app._alias("server", "tool_a")
    assert len(app._alias("s" * 80, "t" * 80)) <= 64


def test_no_mcp_keeps_the_plain_message_path(monkeypatch) -> None:
    messages = Messages([response(Block(type="text", text="Hello"))])
    monkeypatch.setattr(app, "_client", SimpleNamespace(messages=messages))
    monkeypatch.setattr(app, "MOCK", False)

    text, usage, receipts = asyncio.run(app.answer("hi", [], []))

    assert text == "Hello"
    assert usage == {"inputTokens": 2, "outputTokens": 3}
    assert receipts == []
    assert "tools" not in messages.calls[0]


def test_tool_loop_returns_the_result_to_claude_and_echoes_receipt(monkeypatch) -> None:
    grant = server()
    binding = app.ToolBinding(
        alias="mcp-orders__get_order",
        server=grant,
        tool=Tool(
            name="get_order",
            description="Get the current order",
            inputSchema={"type": "object", "properties": {"id": {"type": "string"}}},
        ),
    )
    messages = Messages(
        [
            response(
                Block(
                    type="tool_use",
                    id="tool-1",
                    name=binding.alias,
                    input={"id": "48213"},
                )
            ),
            response(Block(type="text", text="Order 48213 has shipped."), input_tokens=4),
        ]
    )

    async def discover(_servers):
        return [binding]

    async def invoke(_binding, arguments):
        assert arguments == {"id": "48213"}
        return "shipped", False, "signed-receipt"

    monkeypatch.setattr(app, "_client", SimpleNamespace(messages=messages))
    monkeypatch.setattr(app, "MOCK", False)
    monkeypatch.setattr(app, "discover_tools", discover)
    monkeypatch.setattr(app, "invoke_tool", invoke)

    text, usage, receipts = asyncio.run(app.answer("Where is order 48213?", [], [grant]))

    assert text == "Order 48213 has shipped."
    assert usage == {"inputTokens": 6, "outputTokens": 6}
    assert receipts == ["signed-receipt"]
    assert messages.calls[0]["tool_choice"] == {"type": "auto"}
    assert messages.calls[1]["messages"][-1]["content"][0] == {
        "type": "tool_result",
        "tool_use_id": "tool-1",
        "content": "shipped",
        "is_error": False,
    }


def test_round_limit_stops_repeated_tool_requests(monkeypatch) -> None:
    grant = server()
    binding = app.ToolBinding(
        alias="mcp-orders__get_order",
        server=grant,
        tool=Tool(name="get_order", inputSchema={"type": "object"}),
    )
    messages = Messages(
        [
            response(Block(type="tool_use", id=f"tool-{index}", name=binding.alias, input={}))
            for index in range(app.MCP_MAX_ROUNDS)
        ]
    )

    async def discover(_servers):
        return [binding]

    async def invoke(_binding, _arguments):
        return "still working", False, "receipt"

    monkeypatch.setattr(app, "_client", SimpleNamespace(messages=messages))
    monkeypatch.setattr(app, "MOCK", False)
    monkeypatch.setattr(app, "discover_tools", discover)
    monkeypatch.setattr(app, "invoke_tool", invoke)

    text, usage, receipts = asyncio.run(app.answer("Check it", [], [grant]))

    assert text == "I could not complete the tool workflow within the allowed number of steps."
    assert len(messages.calls) == app.MCP_MAX_ROUNDS
    assert len(receipts) == app.MCP_MAX_ROUNDS
    assert usage == {
        "inputTokens": 2 * app.MCP_MAX_ROUNDS,
        "outputTokens": 3 * app.MCP_MAX_ROUNDS,
    }
