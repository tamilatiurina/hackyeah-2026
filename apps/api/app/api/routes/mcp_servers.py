"""FR-16: register and edit MCP servers (URL, auth, allowed tools)."""

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.mcp.agent_access import AgentMcpRepository, get_agent_mcp_repository
from app.mcp.models import McpServer, McpServerCreate, McpServerUpdate
from app.mcp.repository import McpServerRepository, NameTakenError, get_mcp_server_repository

router = APIRouter(prefix="/mcp-servers", tags=["mcp-servers"])

Repo = Annotated[McpServerRepository, Depends(get_mcp_server_repository)]
Access = Annotated[AgentMcpRepository, Depends(get_agent_mcp_repository)]


def _with_agents(server: McpServer, counts: dict[str, int]) -> McpServer:
    return server.model_copy(update={"agents": counts.get(server.id, 0)})


def _name_taken(name: str | None) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, f"MCP server '{name}' already exists")


@router.get("")
def list_mcp_servers(repo: Repo, access: Access) -> list[McpServer]:
    counts = access.counts()
    return [_with_agents(server, counts) for server in repo.list()]


@router.get("/{server_id}")
def get_mcp_server(server_id: str, repo: Repo, access: Access) -> McpServer:
    server = repo.get(server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found")
    return _with_agents(server, access.counts())


@router.post("", status_code=status.HTTP_201_CREATED)
def register_mcp_server(body: McpServerCreate, repo: Repo) -> McpServer:
    try:
        return repo.add(f"mcp-{uuid4().hex[:8]}", body)
    except NameTakenError as error:
        raise _name_taken(body.name) from error


@router.patch("/{server_id}")
def update_mcp_server(
    server_id: str, body: McpServerUpdate, repo: Repo, access: Access
) -> McpServer:
    """Removing a tool also removes it from every agent; an agent left with none loses it."""
    try:
        server = repo.update(server_id, body)
    except NameTakenError as error:
        raise _name_taken(body.name) from error
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found")
    return _with_agents(server, access.counts())


@router.delete("/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mcp_server(server_id: str, repo: Repo) -> Response:
    if not repo.delete(server_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
