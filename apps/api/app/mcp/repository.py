"""Where MCP servers are stored: each user's own registry in Supabase.

Same pattern as app/guardrails/repository.py: queries run as the signed-in user, so RLS shows
and changes only their servers. Secrets are written but can never be selected back (see the
mcp_servers migration).
"""

from collections.abc import Callable
from typing import Any, Protocol, TypeVar

import httpx
from app.core.auth import Me
from app.mcp.models import (
    ApiKeyAuth,
    Auth,
    AuthSummary,
    McpServer,
    McpServerCreate,
    McpServerUpdate,
    OAuthAuth,
)
from fastapi import HTTPException, status
from postgrest import ReturnMethod
from postgrest.exceptions import APIError
from pydantic import ValidationError

from supabase import Client

TABLE = "mcp_servers"
# Never auth_secret: signed-in users are not allowed to select it.
_COLUMNS = "id,name,url,auth_type,auth_header,oauth_client_id,oauth_scopes,allowed_tools"

T = TypeVar("T")


class NameTakenError(Exception):
    pass


class McpServerRepository(Protocol):
    def list(self) -> list[McpServer]: ...

    def get(self, server_id: str) -> McpServer | None: ...

    def add(self, server_id: str, body: McpServerCreate) -> McpServer: ...

    def update(self, server_id: str, changes: McpServerUpdate) -> McpServer | None:
        """The updated server, or None if it doesn't exist. Raises NameTakenError."""
        ...

    def delete(self, server_id: str) -> bool: ...


def auth_columns(auth: Auth) -> dict[str, Any]:
    """Every auth column, so switching auth type clears the old type's fields."""
    columns: dict[str, Any] = {
        "auth_type": auth.type,
        "auth_header": None,
        "auth_secret": None,
        "oauth_token_url": None,
        "oauth_client_id": None,
        "oauth_scopes": [],
    }
    if isinstance(auth, ApiKeyAuth):
        columns["auth_header"] = auth.header
        columns["auth_secret"] = auth.api_key.get_secret_value()
    elif isinstance(auth, OAuthAuth):
        columns["auth_secret"] = auth.client_secret.get_secret_value()
        columns["oauth_token_url"] = str(auth.token_url)
        columns["oauth_client_id"] = auth.client_id
        columns["oauth_scopes"] = list(auth.scopes)
    return columns


def to_row(server_id: str, body: McpServerCreate) -> dict[str, Any]:
    return {
        "id": server_id,
        "name": body.name,
        "url": str(body.url),
        "allowed_tools": list(body.allowed_tools),
        **auth_columns(body.auth),
    }


def from_row(row: Any) -> McpServer:
    try:
        auth_type = row["auth_type"]
        return McpServer(
            id=row["id"],
            name=row["name"],
            url=row["url"],
            auth=AuthSummary(
                type=auth_type,
                header=row.get("auth_header"),
                client_id=row.get("oauth_client_id"),
                scopes=row.get("oauth_scopes") or [],
                has_secret=auth_type != "none",
            ),
            allowed_tools=row["allowed_tools"],
        )
    except (KeyError, TypeError, ValidationError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Stored MCP server is invalid"
        ) from error


class SupabaseMcpServerRepository:
    def __init__(self, client: Client) -> None:
        self._client = client

    def _run(self, query: Callable[[], T]) -> T:
        try:
            return query()
        except APIError as error:
            code = error.code or ""
            if code.startswith("PGRST3"):  # PostgREST JWT errors: missing, invalid or expired
                raise HTTPException(
                    status.HTTP_401_UNAUTHORIZED, "Invalid or expired access token"
                ) from error
            if code == "23505":
                raise NameTakenError from error
            if code in {"22001", "22P02", "23502", "23514"}:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "MCP server data violates database constraints",
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "MCP server storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "MCP server storage is unavailable"
            ) from error

    def list(self) -> list[McpServer]:
        response = self._run(
            lambda: self._client.table(TABLE).select(_COLUMNS).order("position").execute()
        )
        return [from_row(row) for row in response.data]

    def get(self, server_id: str) -> McpServer | None:
        response = self._run(
            lambda: (
                self._client.table(TABLE).select(_COLUMNS).eq("id", server_id).limit(1).execute()
            )
        )
        return from_row(response.data[0]) if response.data else None

    def add(self, server_id: str, body: McpServerCreate) -> McpServer:
        row = to_row(server_id, body)
        # minimal: don't ask the database to send the row back (it would include auth_secret,
        # which signed-in users may not select).
        self._run(
            lambda: self._client.table(TABLE).insert(row, returning=ReturnMethod.minimal).execute()
        )
        return from_row(row)

    def update(self, server_id: str, changes: McpServerUpdate) -> McpServer | None:
        if self.get(server_id) is None:
            return None
        values: dict[str, Any] = {}
        if changes.name is not None:
            values["name"] = changes.name
        if changes.url is not None:
            values["url"] = str(changes.url)
        if changes.allowed_tools is not None:
            values["allowed_tools"] = list(changes.allowed_tools)  # the trigger syncs agents
        if changes.auth is not None:
            values.update(auth_columns(changes.auth))
        if values:
            # minimal: the row includes auth_secret, which signed-in users may not select.
            self._run(
                lambda: (
                    self._client.table(TABLE)
                    .update(values, returning=ReturnMethod.minimal)
                    .eq("id", server_id)
                    .execute()
                )
            )
        return self.get(server_id)

    def delete(self, server_id: str) -> bool:
        if self.get(server_id) is None:
            return False
        self._run(
            lambda: (
                self._client.table(TABLE)
                .delete(returning=ReturnMethod.minimal)
                .eq("id", server_id)
                .execute()
            )
        )
        return True


def get_mcp_server_repository(user: Me) -> McpServerRepository:
    """FastAPI dependency: the signed-in user's MCP servers."""
    return SupabaseMcpServerRepository(user.client)
