"""FR-17: give an agent access to registered MCP servers and choose its tools.

The gateway passes each agent's access to it on every call, in
params.metadata.guardrailHub.mcpServers (docs/agent-contract-a2a.md).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.mcp.agent_access import AgentMcpRepository, AgentNotFoundError, get_agent_mcp_repository
from app.mcp.models import AgentMcpAccess, AgentMcpServer
from app.mcp.repository import McpServerRepository, get_mcp_server_repository

router = APIRouter(prefix="/agents", tags=["agent mcp servers"])

Access = Annotated[AgentMcpRepository, Depends(get_agent_mcp_repository)]
Servers = Annotated[McpServerRepository, Depends(get_mcp_server_repository)]

_AGENT_NOT_FOUND = "Agent not found"


@router.get("/{agent_id}/mcp-servers")
def list_agent_mcp_servers(agent_id: UUID, access: Access) -> list[AgentMcpServer]:
    try:
        return access.list(str(agent_id))
    except AgentNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _AGENT_NOT_FOUND) from error


@router.put("/{agent_id}/mcp-servers/{server_id}")
def set_agent_mcp_server(
    agent_id: UUID, server_id: str, body: AgentMcpAccess, access: Access, servers: Servers
) -> AgentMcpServer:
    """Grant the server to the agent with exactly these tools (attach, or replace the tools)."""
    server = servers.get(server_id)
    if server is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "MCP server not found")
    unknown = [tool for tool in body.allowed_tools if tool not in server.allowed_tools]
    if unknown:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            f"{server.name} does not offer: {', '.join(unknown)}",
        )
    try:
        return access.put(str(agent_id), server, body.allowed_tools)
    except AgentNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _AGENT_NOT_FOUND) from error


@router.delete("/{agent_id}/mcp-servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_agent_mcp_server(agent_id: UUID, server_id: str, access: Access) -> Response:
    try:
        removed = access.delete(str(agent_id), server_id)
    except AgentNotFoundError as error:
        raise HTTPException(status.HTTP_404_NOT_FOUND, _AGENT_NOT_FOUND) from error
    if not removed:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The agent has no access to this server")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
