"""Where guardrails are stored: each user's own library in Supabase.

Queries run as the signed-in user (app.core.auth), so RLS shows and changes only their rows;
owner_id is filled in by the database. Routes only talk to `GuardrailRepository`, so tests can
swap in a fake.
"""

from collections.abc import Callable
from typing import Any, Protocol, TypeVar

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.core.auth import Me
from app.guardrails.models import Guardrail
from supabase import Client

TABLE = "guardrails"
_COLUMNS = "id,name,description,engine,stages,action,config,enabled,is_mandatory"

T = TypeVar("T")


class GuardrailRepository(Protocol):
    def list(self) -> list[Guardrail]: ...

    def get(self, guardrail_id: str) -> Guardrail | None: ...

    def add(self, guardrail: Guardrail) -> None: ...

    def replace(self, guardrail: Guardrail) -> None: ...

    def delete(self, guardrail_id: str) -> bool: ...


def to_row(guardrail: Guardrail) -> dict[str, Any]:
    return guardrail.model_dump(mode="json")


class SupabaseGuardrailRepository:
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
                raise HTTPException(
                    status.HTTP_409_CONFLICT, "A guardrail with this id already exists"
                ) from error
            if code in {"22001", "22P02", "23502", "23514"}:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "Guardrail data violates database constraints",
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Guardrail storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Guardrail storage is unavailable"
            ) from error

    @staticmethod
    def _from_row(row: Any) -> Guardrail:
        try:
            return Guardrail.model_validate(row)
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Stored guardrail is invalid"
            ) from error

    def list(self) -> list[Guardrail]:
        response = self._run(
            lambda: self._client.table(TABLE).select(_COLUMNS).order("position").execute()
        )
        return [self._from_row(row) for row in response.data]

    def get(self, guardrail_id: str) -> Guardrail | None:
        response = self._run(
            lambda: (
                self._client.table(TABLE).select(_COLUMNS).eq("id", guardrail_id).limit(1).execute()
            )
        )
        return self._from_row(response.data[0]) if response.data else None

    def add(self, guardrail: Guardrail) -> None:
        self._run(lambda: self._client.table(TABLE).insert(to_row(guardrail)).execute())

    def replace(self, guardrail: Guardrail) -> None:
        row = to_row(guardrail)
        del row["id"]
        self._run(lambda: self._client.table(TABLE).update(row).eq("id", guardrail.id).execute())

    def delete(self, guardrail_id: str) -> bool:
        response = self._run(
            lambda: self._client.table(TABLE).delete().eq("id", guardrail_id).execute()
        )
        return bool(response.data)


def get_guardrail_repository(user: Me) -> GuardrailRepository:
    """FastAPI dependency: the signed-in user's guardrails."""
    return SupabaseGuardrailRepository(user.client)
