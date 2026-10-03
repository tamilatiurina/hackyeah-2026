import contextlib
from typing import Annotated, Any
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from postgrest.exceptions import APIError
from postgrest.types import JSON
from pydantic import HttpUrl, ValidationError

from app.api.routes.agents.deps import (
    AgentDatabase,
    ensure_public_upstream,
    get_agent_database,
    get_http_client,
)
from app.api.routes.agents.models import (
    AGENT_CARD_PATH,
    Agent,
    AgentCard,
    AgentList,
    AgentRegistration,
    AgentUpdate,
)

router = APIRouter(prefix="/agents", tags=["agents"])

_PUBLIC_AGENT_COLUMNS = (
    "id,name,description,base_url,upstream_url,auth_header_name,agent_card,config_version"
)
_PUBLIC_FIELDS = set(_PUBLIC_AGENT_COLUMNS.split(","))
_MAX_CARD_BYTES = 256_000


def agent_card_url(base_url: HttpUrl) -> HttpUrl:
    """Where an agent publishes its A2A Agent Card, relative to its base URL."""
    url = str(base_url).rstrip("/")
    if url.endswith(AGENT_CARD_PATH):
        return HttpUrl(url)
    return HttpUrl(url + AGENT_CARD_PATH)


def _bad_card(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=detail)


async def fetch_agent_card(
    client: httpx.AsyncClient,
    base_url: HttpUrl,
    headers: dict[str, str] | None,
) -> tuple[AgentCard, dict[str, Any]]:
    """Fetch and validate the agent's Agent Card; it must offer an A2A 1.0 JSON-RPC interface.

    Returns the parsed card and the card exactly as served, for the stored snapshot.
    """
    url = agent_card_url(base_url)
    upstream = await ensure_public_upstream(url)
    try:
        request = client.build_request(
            "GET",
            upstream.url,
            headers={"Accept": "application/json", **(headers or {})},
            extensions={"sni_hostname": upstream.sni_hostname},
        )
        request.headers["Host"] = upstream.host_header
        response = await client.send(request)
        response.raise_for_status()
    except httpx.HTTPError as error:
        raise _bad_card(f"Could not fetch the agent's A2A Agent Card from {url}") from error

    if len(response.content) > _MAX_CARD_BYTES:
        raise _bad_card("The Agent Card is too large")
    try:
        card = AgentCard.model_validate_json(response.content)
    except ValidationError as error:
        first = error.errors()[0]
        location = ".".join(str(part) for part in first["loc"]) or "card"
        raise _bad_card(f"The Agent Card is invalid: {location}: {first['msg']}") from error

    interface = card.jsonrpc_interface()
    if interface is None:
        raise _bad_card("The Agent Card has no A2A 1.0 JSON-RPC interface")
    try:
        await ensure_public_upstream(interface.url)
    except HTTPException as error:
        raise _bad_card(
            "The Agent Card's JSON-RPC endpoint must resolve only to public IP addresses"
        ) from error
    snapshot: dict[str, Any] = response.json()
    return card, snapshot


def _database_row(
    agent_id: str,
    owner_id: str,
    registration: AgentRegistration,
    card: AgentCard,
    snapshot: dict[str, Any],
) -> dict[str, JSON]:
    interface = card.jsonrpc_interface()
    assert interface is not None  # checked by fetch_agent_card
    return {
        "id": agent_id,
        "owner_id": owner_id,
        "config_version": 1,
        "name": registration.name if registration.name is not None else card.name[:100],
        "description": (
            registration.description
            if registration.description is not None
            else card.description[:1_000]
        ),
        "base_url": str(registration.base_url),
        "upstream_url": str(interface.url),
        "auth_header_name": (
            registration.auth_header.name if registration.auth_header is not None else None
        ),
        "auth_header_value": (
            registration.auth_header.value.get_secret_value()
            if registration.auth_header is not None
            else None
        ),
        "agent_card": snapshot,
    }


def _public_agent(row: dict[str, JSON]) -> Agent:
    return Agent.model_validate({k: v for k, v in row.items() if k in _PUBLIC_FIELDS})


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
    headers = (
        {
            registration.auth_header.name: registration.auth_header.value.get_secret_value(),
        }
        if registration.auth_header is not None
        else None
    )
    card, snapshot = await fetch_agent_card(client, registration.base_url, headers)

    row = _database_row(agent_id, database.owner_id, registration, card, snapshot)
    try:
        await run_in_threadpool(lambda: database.client.table("agents").insert(row).execute())
    except APIError as error:
        raise _agent_insert_error(error) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not save agent",
        ) from error

    return _public_agent(row)


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


_SECRET_AGENT_COLUMNS = f"{_PUBLIC_AGENT_COLUMNS},auth_header_value"


def _agent_not_found() -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent not found")


@router.patch("/{agent_id}", response_model=Agent)
async def update_agent(
    agent_id: UUID,
    changes: AgentUpdate,
    client: Annotated[httpx.AsyncClient, Depends(get_http_client)],
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> Agent:
    """FR-02: edit an agent. A saved change bumps `config_version`; a no-op does not.

    Row level security limits this to the owner: someone else's agent is simply not found.
    """
    try:
        response = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .select(_SECRET_AGENT_COLUMNS)
                .eq("id", str(agent_id))
                .limit(1)
                .execute()
            )
        )
    except (APIError, httpx.HTTPError) as error:
        raise _database_error() from error
    if not response.data:
        raise _agent_not_found()
    current: dict[str, JSON] = response.data[0]

    sent = changes.model_fields_set
    new_values: dict[str, JSON] = {}
    if changes.name is not None and changes.name != current["name"]:
        new_values["name"] = changes.name
    if changes.description is not None and changes.description != current["description"]:
        new_values["description"] = changes.description
    if "auth_header" in sent:
        if changes.auth_header is None:
            new_values["auth_header_name"] = None
            new_values["auth_header_value"] = None
        else:
            new_values["auth_header_name"] = changes.auth_header.name
            new_values["auth_header_value"] = changes.auth_header.value.get_secret_value()

    if changes.base_url is not None and str(changes.base_url) != current["base_url"]:
        # The new URL must serve a valid A2A 1.0 Agent Card, fetched with the credentials
        # the agent will have after this edit.
        header_name = new_values.get("auth_header_name", current["auth_header_name"])
        header_value = new_values.get("auth_header_value", current.get("auth_header_value"))
        headers = (
            {str(header_name): str(header_value)}
            if header_name is not None and header_value is not None
            else None
        )
        card, snapshot = await fetch_agent_card(client, changes.base_url, headers)
        interface = card.jsonrpc_interface()
        assert interface is not None  # checked by fetch_agent_card
        new_values["base_url"] = str(changes.base_url)
        new_values["upstream_url"] = str(interface.url)
        new_values["agent_card"] = snapshot

    # Only a real difference creates a new version.
    new_values = {key: value for key, value in new_values.items() if current.get(key) != value}
    if not new_values:
        return _public_agent(current)

    version = current["config_version"]
    assert isinstance(version, int)
    new_values["config_version"] = version + 1
    try:
        # Guarded on the version we read: a concurrent edit makes this match nothing.
        result = await run_in_threadpool(
            lambda: (
                database.client.table("agents")
                .update(new_values)
                .eq("id", str(agent_id))
                .eq("config_version", version)
                .execute()
            )
        )
    except APIError as error:
        raise _agent_insert_error(error) from error
    except httpx.HTTPError as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not save agent"
        ) from error
    if not result.data:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The agent was changed by someone else; reload and try again",
        )
    return _public_agent(result.data[0])


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: UUID,
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> None:
    """FR-02: delete an agent and the guardrail bindings attached to it."""
    try:
        response = await run_in_threadpool(
            lambda: database.client.table("agents").delete().eq("id", str(agent_id)).execute()
        )
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Could not delete agent"
        ) from error
    if not response.data:
        raise _agent_not_found()  # missing, or not owned by the caller (row level security)

    # Bindings go after the agent so that deleting someone else's agent can never reach them.
    # A leftover binding is harmless (agent ids are never reused), so a failure here is ignored.
    with contextlib.suppress(APIError, httpx.HTTPError):
        await run_in_threadpool(
            lambda: (
                database.client.table("rule_bindings")
                .delete()
                .eq("scope_type", "agent")
                .eq("scope_id", str(agent_id))
                .execute()
            )
        )
