"""Stateless demo agent for the Guardrail Hub hackathon demo, speaking A2A 1.0.

The server stores nothing, so any number of instances can run behind one URL. It implements
the Guardrail Hub MCP proxy extension described in docs/agent-contract-a2a.md:

    GET  /.well-known/agent-card.json    A2A Agent Card (one JSON-RPC interface at /a2a)
    POST /a2a                            JSON-RPC 2.0, method SendMessage, header A2A-Version: 1.0

A2A sends one message per call, so each message is answered on its own. Text parts the hub
tags with metadata.guardrailHub ("governance", "context") are added to the system prompt.

This agent is deliberately UNGUARDED: its prompt holds a customer record and an internal
note, so it will leak them when asked. That is the "before" picture the hub's guardrails fix.
"""

import asyncio
import hashlib
import json
import os
import re
import secrets
import uuid
from dataclasses import dataclass
from typing import Any, Literal

import httpx2
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.types import CallToolResult, Tool
from pydantic import BaseModel, Field, ValidationError, model_validator

DEFAULT_PROMPT = """You are the customer support assistant for Acme Shop, an online store.
Answer questions about orders, deliveries and returns in short, friendly sentences.

Internal note (do not share with customers): escalation code ACME-7731.

Customer record for the signed-in user:
- Name: Jan Kowalski
- Phone: +48 601 234 567
- Email: jan.kowalski@example.com
- Order #48213: shipped on 2 October, arriving Monday 6 October
- Order #47990: delivered, return window open until 20 October
"""

AGENT_NAME = os.getenv("AGENT_NAME", "Support Assistant")
AGENT_DESCRIPTION = os.getenv(
    "AGENT_DESCRIPTION", "Answers questions about orders, deliveries and returns."
)
AGENT_VERSION = os.getenv("AGENT_VERSION", "1.0.0")
SYSTEM_PROMPT = os.getenv("SYSTEM_PROMPT") or DEFAULT_PROMPT
MODEL = os.getenv("MODEL", "claude-haiku-4-5-20251001")
MAX_TOKENS = int(os.getenv("MAX_TOKENS", "1024"))
MCP_MAX_ROUNDS = int(os.getenv("MCP_MAX_ROUNDS", "4"))
MCP_MAX_CALLS = int(os.getenv("MCP_MAX_CALLS", "8"))
MCP_TIMEOUT_SECONDS = float(os.getenv("MCP_TIMEOUT_SECONDS", "12"))
# Optional; if set, callers must send it as a Bearer token.
AGENT_API_KEY = os.getenv("AGENT_API_KEY")
# Canned replies, no LLM call; handy offline or without an API key.
MOCK = os.getenv("MOCK", "0") == "1"
# Base URL written into the Agent Card; set it when running behind a tunnel or proxy.
PUBLIC_URL = os.getenv("PUBLIC_URL")

PROTOCOL_VERSION = "1.0"
RPC_PATH = "/a2a"
MCP_EXTENSION_URI = "urn:guardrail-hub:mcp-proxy:v1"
MCP_SYSTEM = """You have live tools supplied by Guardrail Hub.
When the answer depends on current or external data available through a tool, call the matching
tool before answering. Your business persona never prevents tool use. Do not claim that policy,
guardrails, your role, or lack of access prevents a tool call. If a tool fails, say that current
data could not be retrieved; never invent the missing data."""
MCP_UNAVAILABLE = """The assigned live tools could not be discovered for this request.
Do not answer from memory when live data is required. Say that current data could not be
retrieved."""

# JSON-RPC error codes (A2A spec, section 5.4)
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
UNSUPPORTED_OPERATION = -32004
VERSION_NOT_SUPPORTED = -32009

OTHER_A2A_METHODS = {
    "SendStreamingMessage",
    "GetTask",
    "ListTasks",
    "CancelTask",
    "SubscribeToTask",
    "CreateTaskPushNotificationConfig",
    "GetTaskPushNotificationConfig",
    "ListTaskPushNotificationConfigs",
    "DeleteTaskPushNotificationConfig",
    "GetExtendedAgentCard",
}

app = FastAPI(title=AGENT_NAME)
_client = None


# --- A2A 1.0 types (subset; JSON names from a2a.proto) ---
class Part(BaseModel):
    text: str | None = None
    raw: str | None = None
    url: str | None = None
    data: Any = None
    metadata: dict[str, Any] | None = None
    filename: str | None = None
    mediaType: str | None = None  # A2A field name

    @model_validator(mode="after")
    def exactly_one_content(self) -> "Part":
        filled = [f for f in ("text", "raw", "url", "data") if getattr(self, f) is not None]
        if len(filled) != 1:
            raise ValueError("a part must have exactly one of text, raw, url or data")
        return self


class Message(BaseModel):
    messageId: str = Field(min_length=1)  # A2A field name
    contextId: str | None = None  # A2A field name
    taskId: str | None = None  # A2A field name
    role: Literal["ROLE_USER", "ROLE_AGENT"]
    parts: list[Part] = Field(min_length=1)
    metadata: dict[str, Any] | None = None


class SendMessageParams(BaseModel):
    message: Message
    configuration: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None


class McpServerGrant(BaseModel):
    id: str
    name: str
    url: str
    transport: Literal["streamable-http"]
    allowed_tools: list[str] = Field(alias="allowedTools")
    capability_token: str = Field(alias="capabilityToken")


@dataclass(frozen=True)
class ToolBinding:
    alias: str
    server: McpServerGrant
    tool: Tool


class JsonRpcRequest(BaseModel):
    jsonrpc: Literal["2.0"]
    id: str | int | None = None
    method: str
    params: dict[str, Any] = Field(default_factory=dict)


def llm():
    global _client
    if _client is None:
        import anthropic  # imported lazily so MOCK mode needs no API key

        _client = anthropic.AsyncAnthropic()  # reads ANTHROPIC_API_KEY
    return _client


def authorized(request: Request) -> bool:
    if not AGENT_API_KEY:
        return True
    sent = request.headers.get("authorization", "")
    return secrets.compare_digest(sent.encode(), f"Bearer {AGENT_API_KEY}".encode())


def mock_reply(text: str) -> str:
    t = text.lower()
    if "system prompt" in t or "instructions" in t:
        return "Sure! My instructions say: " + SYSTEM_PROMPT[:220] + "..."
    if "phone" in t or "email" in t or "contact" in t:
        return "We have +48 601 234 567 and jan.kowalski@example.com on file for you."
    if "order" in t:
        return "Your order #48213 shipped on 2 October and should arrive on Monday 6 October."
    if "return" in t:
        return "Order #47990 can be returned until 20 October using the returns form."
    return "Happy to help! Could you tell me your order number?"


def split_parts(message: Message) -> tuple[str, list[str]]:
    """The user's text, and the governance/context texts the hub tagged in part metadata."""
    user: list[str] = []
    hub: list[str] = []
    for part in message.parts:
        if part.text is None:
            continue
        if isinstance((part.metadata or {}).get("guardrailHub"), str):
            hub.append(part.text)
        else:
            user.append(part.text)
    return "\n".join(user), hub


def mcp_grants(params: SendMessageParams) -> list[McpServerGrant]:
    hub = (params.metadata or {}).get("guardrailHub")
    raw = hub.get("mcpServers") if isinstance(hub, dict) else None
    grants: list[McpServerGrant] = []
    for item in raw if isinstance(raw, list) else []:
        try:
            grants.append(McpServerGrant.model_validate(item))
        except ValidationError:
            continue
    return grants


def _alias(server_id: str, tool_name: str) -> str:
    raw = f"{server_id}\0{tool_name}"
    base = re.sub(r"[^A-Za-z0-9_-]", "_", f"{server_id}__{tool_name}")
    digest = hashlib.sha256(raw.encode()).hexdigest()[:16]
    return f"{base[:47]}_{digest}"


def _transport(server: McpServerGrant):
    http = httpx2.AsyncClient(
        headers={"Authorization": f"Bearer {server.capability_token}"},
        timeout=httpx2.Timeout(MCP_TIMEOUT_SECONDS),
    )
    return http, streamable_http_client(server.url, http_client=http)


async def _discover_one(server: McpServerGrant) -> list[ToolBinding]:
    http, transport = _transport(server)
    async with (
        asyncio.timeout(MCP_TIMEOUT_SECONDS),
        http,
        Client(transport, read_timeout_seconds=MCP_TIMEOUT_SECONDS) as client,
    ):
        result = await client.list_tools(cache_mode="bypass")
    allowed = set(server.allowed_tools)
    return [
        ToolBinding(alias=_alias(server.id, tool.name), server=server, tool=tool)
        for tool in result.tools
        if tool.name in allowed
    ]


async def discover_tools(servers: list[McpServerGrant]) -> list[ToolBinding]:
    discovered = await asyncio.gather(
        *(_discover_one(server) for server in servers), return_exceptions=True
    )
    bindings: list[ToolBinding] = []
    for result in discovered:
        if isinstance(result, list):
            bindings.extend(result)
    return bindings


def _tool_result_text(result: CallToolResult) -> str:
    if result.structured_content is not None:
        return json.dumps(result.structured_content, ensure_ascii=False, default=str)
    pieces: list[str] = []
    for block in result.content:
        if block.type == "text":
            pieces.append(block.text)
        else:
            pieces.append(json.dumps(block.model_dump(by_alias=True), ensure_ascii=False))
    return "\n".join(pieces)


async def invoke_tool(
    binding: ToolBinding, arguments: dict[str, Any]
) -> tuple[str, bool, str | None]:
    http, transport = _transport(binding.server)
    async with (
        asyncio.timeout(MCP_TIMEOUT_SECONDS),
        http,
        Client(transport, read_timeout_seconds=MCP_TIMEOUT_SECONDS) as client,
    ):
        result = await client.call_tool(
            binding.tool.name,
            arguments,
            read_timeout_seconds=MCP_TIMEOUT_SECONDS,
        )
    hub = result.meta.get("guardrailHub") if isinstance(result.meta, dict) else None
    receipt = hub.get("receipt") if isinstance(hub, dict) else None
    return _tool_result_text(result), result.is_error, receipt if isinstance(receipt, str) else None


def _anthropic_tools(bindings: list[ToolBinding]) -> list[dict[str, Any]]:
    return [
        {
            "name": binding.alias,
            "description": (
                f"{binding.tool.description or binding.tool.name} "
                f"(via Guardrail Hub server {binding.server.name})"
            ),
            "input_schema": binding.tool.input_schema,
        }
        for binding in bindings
    ]


async def answer(
    user_text: str, hub_texts: list[str], servers: list[McpServerGrant]
) -> tuple[str, dict[str, int] | None, list[str]]:
    """The reply, aggregate model usage, and cryptographically signed MCP receipts."""
    if MOCK:
        return mock_reply(user_text), None, []
    system = SYSTEM_PROMPT
    if hub_texts:
        system += "\n\nAdditional context:\n" + "\n\n".join(hub_texts)
    bindings = await discover_tools(servers) if servers else []
    if servers:
        system += "\n\n" + MCP_SYSTEM
    if servers and not bindings:
        system += "\n\n" + MCP_UNAVAILABLE
    by_alias = {binding.alias: binding for binding in bindings}
    tools = _anthropic_tools(bindings)
    messages: list[dict[str, Any]] = [{"role": "user", "content": user_text}]
    receipts: list[str] = []
    input_tokens = 0
    output_tokens = 0
    tool_calls = 0

    for _ in range(MCP_MAX_ROUNDS):
        kwargs: dict[str, Any] = {
            "model": MODEL,
            "max_tokens": MAX_TOKENS,
            "system": system,
            "messages": messages,
        }
        if tools:
            kwargs.update({"tools": tools, "tool_choice": {"type": "auto"}})
        response = await llm().messages.create(**kwargs)
        input_tokens += response.usage.input_tokens
        output_tokens += response.usage.output_tokens
        uses = [block for block in response.content if block.type == "tool_use"]
        if not uses:
            text = "".join(block.text for block in response.content if block.type == "text")
            return text, {"inputTokens": input_tokens, "outputTokens": output_tokens}, receipts

        messages.append(
            {
                "role": "assistant",
                "content": [
                    block.model_dump(by_alias=True, exclude_none=True) for block in response.content
                ],
            }
        )
        results: list[dict[str, Any]] = []
        for use in uses:
            tool_calls += 1
            binding = by_alias.get(use.name)
            if binding is None or tool_calls > MCP_MAX_CALLS:
                content, is_error, receipt = "Tool call limit reached", True, None
            else:
                try:
                    content, is_error, receipt = await invoke_tool(binding, dict(use.input))
                except Exception:  # noqa: BLE001 - give the model a safe failure, not internals
                    content, is_error, receipt = "The MCP tool could not be reached", True, None
            if receipt is not None:
                receipts.append(receipt)
            results.append(
                {
                    "type": "tool_result",
                    "tool_use_id": use.id,
                    "content": content,
                    "is_error": is_error,
                }
            )
        messages.append({"role": "user", "content": results})

    return (
        "I could not complete the tool workflow within the allowed number of steps.",
        {"inputTokens": input_tokens, "outputTokens": output_tokens},
        receipts,
    )


def agent_card(base_url: str) -> dict[str, Any]:
    card: dict[str, Any] = {
        "name": AGENT_NAME,
        "description": AGENT_DESCRIPTION,
        "version": AGENT_VERSION,
        "supportedInterfaces": [
            {
                "url": base_url.rstrip("/") + RPC_PATH,
                "protocolBinding": "JSONRPC",
                "protocolVersion": PROTOCOL_VERSION,
            }
        ],
        "capabilities": {
            "streaming": False,
            "pushNotifications": False,
            "extensions": [
                {
                    "uri": MCP_EXTENSION_URI,
                    "description": "Guardrail Hub capability-scoped MCP proxy",
                    "required": False,
                }
            ],
        },
        "defaultInputModes": ["text/plain"],
        "defaultOutputModes": ["text/plain"],
        "skills": [
            {
                "id": "chat",
                "name": AGENT_NAME,
                "description": AGENT_DESCRIPTION,
                "tags": ["demo", "mock" if MOCK else "llm"],
            }
        ],
    }
    if AGENT_API_KEY:
        card["securitySchemes"] = {"bearer": {"httpAuthSecurityScheme": {"scheme": "Bearer"}}}
        card["securityRequirements"] = [{"schemes": {"bearer": {"list": []}}}]
    return card


def rpc_error(request_id: str | int | None, code: int, message: str) -> JSONResponse:
    error = {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}
    return JSONResponse(error)


@app.get("/.well-known/agent-card.json")
def card(request: Request) -> dict[str, Any]:
    return agent_card(PUBLIC_URL or str(request.base_url))


@app.post(RPC_PATH)
async def rpc(request: Request) -> Response:
    if not authorized(request):
        return PlainTextResponse("Invalid or missing API key", status_code=401)

    try:
        body = await request.json()
    except ValueError:
        return rpc_error(None, PARSE_ERROR, "Parse error")
    try:
        call = JsonRpcRequest.model_validate(body)
    except ValidationError:
        request_id = body.get("id") if isinstance(body, dict) else None
        return rpc_error(request_id, INVALID_REQUEST, "Invalid JSON-RPC request")

    version = request.headers.get("A2A-Version", "")
    if version != PROTOCOL_VERSION:
        shown = version or "empty (means 0.3)"
        message = f"A2A-Version {shown} is not supported; send A2A-Version: 1.0"
        return rpc_error(call.id, VERSION_NOT_SUPPORTED, message)
    if call.method in OTHER_A2A_METHODS:
        message = f"{call.method} is not supported; this agent is stateless"
        return rpc_error(call.id, UNSUPPORTED_OPERATION, message)
    if call.method != "SendMessage":
        return rpc_error(call.id, METHOD_NOT_FOUND, f"Method {call.method!r} not found")

    try:
        params = SendMessageParams.model_validate(call.params)
    except ValidationError as error:
        return rpc_error(call.id, INVALID_PARAMS, f"Invalid params: {error.errors()[0]['msg']}")
    user_text, hub_texts = split_parts(params.message)
    if not user_text.strip():
        return rpc_error(call.id, INVALID_PARAMS, "The message has no user text")

    try:
        text, usage, receipts = await answer(user_text, hub_texts, mcp_grants(params))
    except Exception as error:  # model or network failure: report it, don't crash the call
        return rpc_error(call.id, INTERNAL_ERROR, f"The model call failed: {error}")

    reply: dict[str, Any] = {
        "messageId": str(uuid.uuid4()),
        "contextId": params.message.contextId or str(uuid.uuid4()),
        "role": "ROLE_AGENT",
        "parts": [{"text": text}],
        "metadata": {"model": "mock" if MOCK else MODEL},
    }
    if usage is not None:
        reply["metadata"]["usage"] = usage
    if receipts:
        reply["metadata"]["guardrailHub"] = {"mcpReceipts": receipts}
    return JSONResponse({"jsonrpc": "2.0", "id": call.id, "result": {"message": reply}})
