from typing import Annotated
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError
from postgrest.types import JSON
from pydantic import ValidationError

from app.api.routes.agents.deps import (
    AgentDatabase,
    ensure_public_upstream,
    get_agent_database,
    get_http_client,
)
from app.api.routes.agents.models import Agent, AgentList, AgentRegistration

router = APIRouter(prefix="/agents", tags=["agents"])

_PUBLIC_AGENT_COLUMNS = (
    "id,name,description,upstream_url,auth_header_name,request_format,response_format"
)


def _public_agent(agent_id: str, registration: AgentRegistration) -> Agent:
    return Agent(
        id=agent_id,
        name=registration.name,
        description=registration.description,
        upstream_url=registration.upstream_url,
        auth_header_name=(
            registration.auth_header.name if registration.auth_header is not None else None
        ),
        request_format=registration.request_format,
        response_format=registration.response_format,
    )


def _database_row(
    agent_id: str,
    owner_id: str,
    registration: AgentRegistration,
) -> dict[str, JSON]:
    return {
        "id": agent_id,
        "owner_id": owner_id,
        "name": registration.name,
        "description": registration.description,
        "upstream_url": str(registration.upstream_url),
        "auth_header_name": (
            registration.auth_header.name if registration.auth_header is not None else None
        ),
        "auth_header_value": (
            registration.auth_header.value.get_secret_value()
            if registration.auth_header is not None
            else None
        ),
        "request_format": registration.request_format.value,
        "response_format": registration.response_format.value,
    }


def _database_error() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not read agents",
    )


def _agent_insert_error(error: APIError) -> HTTPException:
    if error.code == "23505":
        return HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An agent with this name already exists",
        )
    if error.code in {"22001", "22P02", "23502", "23514"}:
        return HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Agent data violates database constraints",
        )
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Could not save agent",
    )


@router.post("", response_model=Agent, status_code=status.HTTP_201_CREATED)
async def register_agent(
    registration: AgentRegistration,
    client: Annotated[httpx.AsyncClient, Depends(get_http_client)],
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> Agent:
    agent_id = str(uuid4())
    upstream = await ensure_public_upstream(registration.upstream_url)
    headers = (
        {
            registration.auth_header.name: registration.auth_header.value.get_secret_value(),
        }
        if registration.auth_header is not None
        else None
    )

    try:
        request = client.build_request(
            "GET",
            upstream.url,
            headers=headers,
            extensions={"sni_hostname": upstream.sni_hostname},
        )
        request.headers["Host"] = upstream.host_header
        response = await client.send(request)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Upstream agent did not respond successfully",
        ) from error

    row = _database_row(agent_id, database.owner_id, registration)
    try:
        await run_in_threadpool(lambda: database.client.table("agents").insert(row).execute())
    except APIError as error:
        raise _agent_insert_error(error) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not save agent",
        ) from error

    return _public_agent(agent_id, registration)


@router.get("", response_model=AgentList)
async def list_agents(
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> AgentList:
    try:
        response = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .select(_PUBLIC_AGENT_COLUMNS)
                .order("created_at", desc=True)
                .execute()
            )
        )
        agents = [Agent.model_validate(row) for row in response.data]
    except (APIError, httpx.HTTPError, ValidationError) as error:
        raise _database_error() from error
    return AgentList(data=agents, total=len(agents))


@router.get("/{agent_id}", response_model=Agent)
async def get_agent(
    agent_id: UUID,
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> Agent:
    try:
        response = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .select(_PUBLIC_AGENT_COLUMNS)
                .eq("id", str(agent_id))
                .limit(1)
                .execute()
            )
        )
    except (APIError, httpx.HTTPError) as error:
        raise _database_error() from error

    if not response.data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found",
        )
    try:
        return Agent.model_validate(response.data[0])
    except ValidationError as error:
        raise _database_error() from error
