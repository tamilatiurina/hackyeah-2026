"""FR-17: which registered MCP servers, and which of their tools, each agent may use.

Storage follows app/mcp/repository.py: Supabase as the signed-in user (RLS: only the agent's
owner sees or changes its access; see the mcp_agent_access migration), or memory without
Supabase. The gateway has no signed-in user, so it reads an agent's access through a database
function that checks the gateway key; the test chat reads it as the owner.
"""

import logging
from collections import Counter
from collections.abc import Callable
from typing import Annotated, Any, Protocol, TypeVar

import httpx
from app.core.supabase import get_supabase, get_supabase_for_user
from app.gateway.keys import hash_key
from app.mcp.models import AgentMcpServer, McpGrant, McpServer
from app.mcp.repository import ACCESS, InMemoryMcpServerRepository, supabase_configured
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from postgrest.exceptions import APIError
from pydantic import ValidationError

from supabase import Client

TABLE = "agent_mcp_servers"
Tools = list[str]  # a module-level alias: `list` is also a method name in the classes below
T = TypeVar("T")
logger = logging.getLogger(__name__)
_bearer = HTTPBearer(auto_error=False)


class AgentNotFoundError(Exception):
    """The agent doesn't exist, or the caller isn't its owner (RLS makes the two look alike)."""


class AgentMcpRepository(Protocol):
    def list(self, agent_id: str) -> list[AgentMcpServer]: ...

    def put(self, agent_id: str, server: McpServer, tools: Tools) -> AgentMcpServer:
        """Grant `server` with exactly `tools` (already checked against the server's tools)."""
        ...

    def delete(self, agent_id: str, server_id: str) -> bool: ...

    def counts(self) -> dict[str, int]:
        """Server id -> how many of the caller's agents may use it."""
        ...


def _entry(server: McpServer, allowed: Tools) -> AgentMcpServer:
    return AgentMcpServer(
        server_id=server.id,
        name=server.name,
        url=str(server.url),
        available_tools=list(server.allowed_tools),
        allowed_tools=list(allowed),
    )


class InMemoryAgentMcpRepository:
    def list(self, agent_id: str) -> list[AgentMcpServer]:
        servers = {s.id: s for s in InMemoryMcpServerRepository().list()}
        return [
            _entry(servers[server_id], tools)
            for (agent, server_id), tools in ACCESS.items()
            if agent == agent_id and server_id in servers
        ]

    def put(self, agent_id: str, server: McpServer, tools: Tools) -> AgentMcpServer:
        ACCESS[(agent_id, server.id)] = list(tools)
        return _entry(server, tools)

    def delete(self, agent_id: str, server_id: str) -> bool:
        return ACCESS.pop((agent_id, server_id), None) is not None

    def counts(self) -> dict[str, int]:
        return dict(Counter(server_id for _, server_id in ACCESS))


class SupabaseAgentMcpRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    def _run(self, query: Callable[[], T]) -> T:
        try:
            return query()
        except APIError as error:
            code = error.code or ""
            if code.startswith("PGRST3"):  # PostgREST JWT errors
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token"
                ) from error
            if code in {"23503", "42501", "22P02"}:  # no such agent, not the owner, not a uuid
                raise AgentNotFoundError from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "MCP access storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "MCP access storage is unavailable"
            ) from error

    def list(self, agent_id: str) -> list[AgentMcpServer]:
        response = self._run(
            lambda: (
                self._client.table(TABLE)
                .select("server_id,allowed_tools,mcp_servers(id,name,url,allowed_tools)")
                .eq("agent_id", agent_id)
                .order("created_at")
                .execute()
            )
        )
        entries: list[AgentMcpServer] = []
        for row in response.data:
            server: Any = row.get("mcp_servers")
            if not isinstance(server, dict):
                continue
            entries.append(
                AgentMcpServer(
                    server_id=row["server_id"],
                    name=server["name"],
                    url=server["url"],
                    available_tools=server["allowed_tools"],
                    allowed_tools=row["allowed_tools"],
                )
            )
        return entries

    def put(self, agent_id: str, server: McpServer, tools: Tools) -> AgentMcpServer:
        row = {"agent_id": agent_id, "server_id": server.id, "allowed_tools": list(tools)}
        self._run(
            lambda: (
                self._client.table(TABLE).upsert(row, on_conflict="agent_id,server_id").execute()
            )
        )
        return _entry(server, tools)

    def delete(self, agent_id: str, server_id: str) -> bool:
        response = self._run(
            lambda: (
                self._client.table(TABLE)
                .delete()
                .eq("agent_id", agent_id)
                .eq("server_id", server_id)
                .execute()
            )
        )
        return bool(response.data)

    def counts(self) -> dict[str, int]:
        response = self._run(lambda: self._client.table(TABLE).select("server_id").execute())
        return dict(Counter(row["server_id"] for row in response.data))


def get_agent_mcp_repository(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> AgentMcpRepository:
    """FastAPI dependency: the signed-in user's Supabase view, or memory without Supabase."""
    if not supabase_configured():
        return InMemoryAgentMcpRepository()
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to manage MCP access",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return SupabaseAgentMcpRepository(get_supabase_for_user(credentials.credentials))


# --- what the agent is told on each call ------------------------------------------------------


class McpGrantLoader(Protocol):
    def load(self, agent_id: str, key: str | None) -> list[McpGrant]:
        """The MCP servers and tools this agent may use; `key` is the gateway key, if any."""
        ...


def parse_grants(data: Any) -> list[McpGrant]:
    """The database functions answer a JSON list, or null for a wrong key / non-owner."""
    grants: list[McpGrant] = []
    for item in data if isinstance(data, list) else []:
        try:
            grants.append(McpGrant.model_validate(item))
        except ValidationError:
            logger.warning("Skipping an invalid MCP grant: %r", item)
    return grants


class InMemoryMcpGrantLoader:
    def load(self, agent_id: str, key: str | None) -> list[McpGrant]:
        del key  # the caller is already authenticated
        return [
            McpGrant(id=e.server_id, name=e.name, url=e.url, allowed_tools=e.allowed_tools)
            for e in InMemoryAgentMcpRepository().list(agent_id)
        ]


class GatewayMcpGrantLoader:
    """The guarded URL: gateway_agent_mcp_servers answers only to the agent's key."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def load(self, agent_id: str, key: str | None) -> list[McpGrant]:
        if not key:
            return []
        params = {"p_agent_id": agent_id, "p_key_hash": hash_key(key)}
        return parse_grants(self._client.rpc("gateway_agent_mcp_servers", params).execute().data)


class OwnerMcpGrantLoader:
    """The panel's test chat: owner_agent_mcp_servers answers only to the agent's owner."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def load(self, agent_id: str, key: str | None) -> list[McpGrant]:
        del key
        response = self._client.rpc("owner_agent_mcp_servers", {"p_agent_id": agent_id}).execute()
        return parse_grants(response.data)


def get_gateway_mcp_loader() -> McpGrantLoader:
    if not supabase_configured():
        return InMemoryMcpGrantLoader()
    try:
        return GatewayMcpGrantLoader(get_supabase())
    except RuntimeError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway is not configured"
        ) from error


def load_grants(loader: McpGrantLoader, agent_id: str, key: str | None) -> list[McpGrant]:
    """Never fails the call: if access can't be read, the agent gets no MCP servers."""
    try:
        return loader.load(agent_id, key)
    except Exception:  # noqa: BLE001 - least privilege beats a failed call
        logger.warning("Could not load MCP access for agent %s", agent_id, exc_info=True)
        return []
