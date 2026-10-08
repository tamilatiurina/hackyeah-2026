"""Encrypted MCP capabilities and signed execution receipts.

Capabilities are opaque to an upstream agent. Each one grants one A2A call access to one
registered MCP server and a fixed tool allow-list. Receipts use the same authenticated encryption
and are echoed by a conforming agent so the gateway can publish a trustworthy MCP trace.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Literal

from app.core.config import settings
from app.mcp.models import McpGrant
from cryptography.fernet import Fernet, InvalidToken
from pydantic import BaseModel, Field, ValidationError

MCP_EXTENSION_URI = "urn:guardrail-hub:mcp-proxy:v1"
CAPABILITY_KIND = "mcp-capability-v1"
RECEIPT_KIND = "mcp-receipt-v1"


class CapabilityUnavailableError(RuntimeError):
    """The proxy cannot issue or verify capabilities without its shared key."""


class CapabilityInvalidError(ValueError):
    """A capability or receipt is malformed, expired, or does not match the A2A call."""


class Capability(BaseModel):
    kind: Literal["mcp-capability-v1"] = CAPABILITY_KIND
    agent_id: str
    call_id: str
    server_id: str
    server_name: str
    backend_url: str
    allowed_tools: list[str] = Field(min_length=1)


class McpTraceEntry(BaseModel):
    serverId: str
    serverName: str
    toolName: str
    status: Literal["allowed", "blocked", "error"]
    latencyMs: float = Field(ge=0)


class Receipt(BaseModel):
    kind: Literal["mcp-receipt-v1"] = RECEIPT_KIND
    agent_id: str
    call_id: str
    server_id: str
    server_name: str
    tool_name: str
    status: Literal["allowed", "blocked", "error"]
    latency_ms: float = Field(ge=0)
    issued_at: datetime

    def trace_entry(self) -> McpTraceEntry:
        return McpTraceEntry(
            serverId=self.server_id,
            serverName=self.server_name,
            toolName=self.tool_name,
            status=self.status,
            latencyMs=round(self.latency_ms, 2),
        )


def _fernet() -> Fernet:
    key = settings.MCP_CAPABILITY_KEY.strip()
    if not key:
        raise CapabilityUnavailableError("MCP proxy is not configured")
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeEncodeError) as error:
        raise CapabilityUnavailableError("MCP_CAPABILITY_KEY is not a valid Fernet key") from error


def _ttl_seconds() -> int:
    return max(int(settings.CALL_TIMEOUT_SECONDS + 30), 1)


def _seal(document: BaseModel) -> str:
    body = document.model_dump_json(by_alias=True).encode()
    return _fernet().encrypt(body).decode("ascii")


def _open(token: str, model: type[Capability] | type[Receipt]) -> Capability | Receipt:
    try:
        raw = _fernet().decrypt(token.encode("ascii"), ttl=_ttl_seconds())
        return model.model_validate_json(raw)
    except (InvalidToken, ValidationError, ValueError, UnicodeEncodeError) as error:
        raise CapabilityInvalidError("Invalid or expired MCP capability") from error


def issue_capability(agent_id: str, call_id: str, grant: McpGrant) -> str:
    return _seal(
        Capability(
            agent_id=agent_id,
            call_id=call_id,
            server_id=grant.id,
            server_name=grant.name,
            backend_url=grant.url,
            allowed_tools=grant.allowed_tools,
        )
    )


def read_capability(token: str) -> Capability:
    opened = _open(token, Capability)
    assert isinstance(opened, Capability)
    return opened


def issue_receipt(
    capability: Capability,
    tool_name: str,
    status: Literal["allowed", "blocked", "error"],
    latency_ms: float,
) -> str:
    return _seal(
        Receipt(
            agent_id=capability.agent_id,
            call_id=capability.call_id,
            server_id=capability.server_id,
            server_name=capability.server_name,
            tool_name=tool_name,
            status=status,
            latency_ms=max(latency_ms, 0),
            issued_at=datetime.now(UTC),
        )
    )


def verify_receipts(tokens: object, agent_id: str, call_id: str) -> list[McpTraceEntry]:
    if not isinstance(tokens, list):
        return []
    trace: list[McpTraceEntry] = []
    seen: set[str] = set()
    for token in tokens:
        if not isinstance(token, str) or token in seen:
            continue
        seen.add(token)
        try:
            opened = _open(token, Receipt)
        except (CapabilityInvalidError, CapabilityUnavailableError):
            continue
        assert isinstance(opened, Receipt)
        if opened.agent_id == agent_id and opened.call_id == call_id:
            trace.append(opened.trace_entry())
    return trace


def extract_receipts(reply: dict[str, object]) -> object:
    """Read agent-echoed receipts without trusting any other agent metadata."""
    result = reply.get("result")
    if not isinstance(result, dict):
        return None
    holder = (
        result.get("message") if isinstance(result.get("message"), dict) else result.get("task")
    )
    if not isinstance(holder, dict):
        return None
    metadata = holder.get("metadata")
    if not isinstance(metadata, dict):
        return None
    hub = metadata.get("guardrailHub")
    return hub.get("mcpReceipts") if isinstance(hub, dict) else None


def capability_server(
    grant: McpGrant, *, agent_id: str, call_id: str, proxy_url: str
) -> dict[str, object]:
    """The only MCP connection details disclosed to a conforming upstream agent."""
    return {
        "id": grant.id,
        "name": grant.name,
        "url": proxy_url,
        "transport": "streamable-http",
        "allowedTools": list(grant.allowed_tools),
        "capabilityToken": issue_capability(agent_id, call_id, grant),
    }


def public_proxy_url(request_base_url: str) -> str:
    base = settings.PUBLIC_API_URL.strip() or request_base_url
    return f"{base.rstrip('/')}/mcp-proxy/"


def receipt_meta(token: str) -> dict[str, object]:
    return {"guardrailHub": {"receipt": token}}


def result_size(document: object) -> int:
    return len(json.dumps(document, ensure_ascii=False, default=str).encode())
