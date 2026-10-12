"""B-01: create, replace (rotate) or revoke an agent's gateway key. Owner only (RLS)."""

from typing import Annotated
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.api.routes.agents.deps import AgentDatabase, get_agent_database
from app.gateway.keys import hash_key, new_key

router = APIRouter(prefix="/agents", tags=["agents"])


class GatewayKey(BaseModel):
    agent_id: str
    key: str  # shown only once; store it now. Callers send it in the X-API-Key header.
    gateway_path: str
    agent_card_path: str


@router.post("/{agent_id}/gateway-key", status_code=status.HTTP_201_CREATED)
async def create_gateway_key(
    agent_id: UUID,
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> GatewayKey:
    key = new_key()
    try:
        response = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .update({"gateway_key_hash": hash_key(key)})
                .eq("id", str(agent_id))
                .execute()
            )
        )
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Could not save the gateway key"
        ) from error

    # RLS: updating someone else's agent changes no rows, which looks the same as "not found".
    if not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
    return GatewayKey(
        agent_id=str(agent_id),
        key=key,
        gateway_path=f"/a/{agent_id}",
        agent_card_path=f"/a/{agent_id}/.well-known/agent-card.json",
    )


@router.delete("/{agent_id}/gateway-key", status_code=status.HTTP_204_NO_CONTENT)
async def revoke_gateway_key(
    agent_id: UUID,
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> None:
    """Take the agent offline: its guarded URL answers 401 until a new key is created."""
    try:
        response = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .update({"gateway_key_hash": None})
                .eq("id", str(agent_id))
                .execute()
            )
        )
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Could not revoke the gateway key"
        ) from error
    if not response.data:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agent not found")
