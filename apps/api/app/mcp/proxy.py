"""A capability-scoped, stateless Streamable HTTP MCP proxy."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from contextvars import ContextVar
from time import perf_counter
from typing import Any, Literal, Protocol

import httpx2
from app.api.routes.agents.deps import ResolvedUpstream, ensure_public_upstream
from app.core.config import settings
from app.mcp.capabilities import (
    Capability,
    CapabilityInvalidError,
    CapabilityUnavailableError,
    issue_receipt,
    read_capability,
    receipt_meta,
    result_size,
)
from fastapi import HTTPException
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from mcp.server.mcpserver import MCPServer
from mcp.types import CallToolResult, TextContent, Tool
from pydantic import HttpUrl, ValidationError
from starlette.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Scope, Send

_capability: ContextVar[Capability | None] = ContextVar("mcp_capability", default=None)


class McpBackend(Protocol):
    async def list_tools(self, url: str) -> list[Tool]: ...

    async def call_tool(self, url: str, name: str, arguments: dict[str, Any]) -> CallToolResult: ...


async def _validated_url(url: str) -> ResolvedUpstream:
    try:
        parsed = HttpUrl(url)
    except ValidationError as error:
        raise ValueError("The MCP backend URL is invalid") from error
    try:
        return await ensure_public_upstream(parsed)
    except HTTPException as error:
        raise ValueError(str(error.detail)) from error


@asynccontextmanager
async def _remote_client(url: str) -> AsyncIterator[Client]:
    target = await _validated_url(url)

    async def pin_origin(request: httpx2.Request) -> None:
        request.headers["Host"] = target.host_header
        request.extensions["sni_hostname"] = target.sni_hostname

    timeout = httpx2.Timeout(
        settings.MCP_TOOL_TIMEOUT_SECONDS,
        connect=settings.MCP_CONNECT_TIMEOUT_SECONDS,
    )
    async with httpx2.AsyncClient(
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
        event_hooks={"request": [pin_origin]},
    ) as http:
        transport = streamable_http_client(str(target.url), http_client=http)
        async with Client(
            transport, read_timeout_seconds=settings.MCP_TOOL_TIMEOUT_SECONDS
        ) as client:
            yield client


class RemoteMcpBackend:
    async def list_tools(self, url: str) -> list[Tool]:
        async with (
            asyncio.timeout(settings.MCP_TOOL_TIMEOUT_SECONDS),
            _remote_client(url) as client,
        ):
            result = await client.list_tools(cache_mode="bypass")
            return list(result.tools)

    async def call_tool(self, url: str, name: str, arguments: dict[str, Any]) -> CallToolResult:
        async with (
            asyncio.timeout(settings.MCP_TOOL_TIMEOUT_SECONDS),
            _remote_client(url) as client,
        ):
            return await client.call_tool(
                name,
                arguments,
                read_timeout_seconds=settings.MCP_TOOL_TIMEOUT_SECONDS,
            )


def _error_result(message: str, receipt: str) -> CallToolResult:
    return CallToolResult(
        content=[TextContent(type="text", text=message)],
        isError=True,
        _meta=receipt_meta(receipt),
    )


class GuardrailMcpProxy(MCPServer):
    def __init__(self, backend: McpBackend | None = None) -> None:
        super().__init__(
            name="guardrail-hub-mcp-proxy",
            title="Guardrail Hub MCP proxy",
            description="Capability-scoped proxy for tools assigned to one A2A agent",
        )
        self._backend = backend or RemoteMcpBackend()

    @staticmethod
    def current_capability() -> Capability:
        capability = _capability.get()
        if capability is None:
            raise ValueError("Missing MCP capability")
        return capability

    async def list_tools(self) -> list[Tool]:
        capability = self.current_capability()
        offered = await self._backend.list_tools(capability.backend_url)
        allowed = set(capability.allowed_tools)
        return [tool for tool in offered if tool.name in allowed][: settings.MCP_MAX_TOOLS]

    async def call_tool(
        self, name: str, arguments: dict[str, Any], context: Any = None
    ) -> CallToolResult:
        del context
        capability = self.current_capability()
        started = perf_counter()
        if name not in capability.allowed_tools:
            receipt = issue_receipt(capability, name, "blocked", (perf_counter() - started) * 1000)
            return _error_result(f"Tool {name!r} is not allowed for this agent", receipt)

        try:
            async with asyncio.timeout(settings.MCP_TOOL_TIMEOUT_SECONDS):
                result = await self._backend.call_tool(capability.backend_url, name, arguments)
            status: Literal["allowed", "blocked", "error"] = (
                "error" if result.is_error else "allowed"
            )
            if result_size(result.model_dump(by_alias=True)) > settings.MCP_MAX_RESULT_BYTES:
                status = "error"
                result = CallToolResult(
                    content=[
                        TextContent(type="text", text="MCP tool result exceeded the size limit")
                    ],
                    isError=True,
                )
        except TimeoutError:
            status = "error"
            result = CallToolResult(
                content=[TextContent(type="text", text="MCP tool timed out")], isError=True
            )
        except Exception:  # noqa: BLE001 - backend details must not leak to the agent
            status = "error"
            result = CallToolResult(
                content=[TextContent(type="text", text="MCP tool could not be reached")],
                isError=True,
            )

        receipt = issue_receipt(capability, name, status, (perf_counter() - started) * 1000)
        return result.model_copy(update={"meta": receipt_meta(receipt)})


class CapabilityMiddleware:
    """Authenticate every MCP transport request with its opaque bearer capability."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {key.lower(): value for key, value in scope.get("headers", [])}
        authorization = headers.get(b"authorization", b"").decode("latin-1")
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "bearer" or not token:
            await JSONResponse({"error": "Missing MCP capability"}, status_code=401)(
                scope, receive, send
            )
            return
        try:
            capability = read_capability(token)
        except (CapabilityInvalidError, CapabilityUnavailableError):
            await JSONResponse({"error": "Invalid or expired MCP capability"}, status_code=401)(
                scope, receive, send
            )
            return
        reset = _capability.set(capability)
        try:
            await self.app(scope, receive, send)
        finally:
            _capability.reset(reset)


proxy_server = GuardrailMcpProxy()
_proxy_transport_app = proxy_server.streamable_http_app(
    streamable_http_path="/",
    json_response=True,
    stateless_http=True,
    host="0.0.0.0",
)
proxy_app: ASGIApp = CapabilityMiddleware(_proxy_transport_app)
