"""Load an agent's upstream settings for a call made on the owner's behalf (test chat, scans)."""

from typing import Any, cast
from uuid import UUID

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.api.routes.agents.deps import AgentDatabase
from app.gateway.resolver import UpstreamTarget


def load_upstream_target(database: AgentDatabase, agent_id: UUID) -> UpstreamTarget:
    """The agent's upstream settings, read as the signed-in owner (RLS: someone else's agent
    is a 404, like a missing one). Blocking."""
    try:
        response = (
            database.client.table("agents")
            .select("upstream_url,auth_header_name,auth_header_value")
            .eq("id", str(agent_id))
            .limit(1)
            .execute()
        )
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Could not load the agent"
        ) from error
    if not response.data:  # RLS: someone else's agent looks the same as a missing one
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
    row = cast(dict[str, Any], response.data[0])
    return UpstreamTarget(
        upstream_url=str(row["upstream_url"]),
        auth_header_name=row.get("auth_header_name"),
        auth_header_value=row.get("auth_header_value"),
    )
