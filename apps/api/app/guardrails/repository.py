"""Where guardrails are stored: Supabase when configured, otherwise the in-memory store.

Routes only talk to `GuardrailRepository`, so they don't care which one is in use.

- Supabase (SUPABASE_URL + SUPABASE_KEY set): queries run as the signed-in user, using the
  access token the panel sends. The guardrail library is shared, so every signed-in user can
  read and edit it (see the guardrails migrations). No token -> 401.
- Otherwise (tests, local runs without Supabase): the seeded in-memory store.
"""

from collections.abc import Callable
from typing import Annotated, Any, Protocol, TypeVar

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.core.config import settings
from app.core.supabase import get_supabase, get_supabase_for_user
from app.guardrails.models import Guardrail
from app.store import store
from supabase import Client

TABLE = "guardrails"
_COLUMNS = "id,name,description,engine,stages,action,config,enabled,is_mandatory"

T = TypeVar("T")

_bearer = HTTPBearer(auto_error=False)


class GuardrailRepository(Protocol):
    def list(self) -> list[Guardrail]: ...

    def get(self, guardrail_id: str) -> Guardrail | None: ...

    def add(self, guardrail: Guardrail) -> None: ...

    def replace(self, guardrail: Guardrail) -> None: ...

    def delete(self, guardrail_id: str) -> bool: ...


class InMemoryGuardrailRepository:
    """The seeded `store` from app.store (reset before each test)."""

    def list(self) -> list[Guardrail]:
        return list(store.guardrails.values())

    def get(self, guardrail_id: str) -> Guardrail | None:
        return store.guardrails.get(guardrail_id)

    def add(self, guardrail: Guardrail) -> None:
        store.guardrails[guardrail.id] = guardrail

    def replace(self, guardrail: Guardrail) -> None:
        store.guardrails[guardrail.id] = guardrail

    def delete(self, guardrail_id: str) -> bool:
        return store.guardrails.pop(guardrail_id, None) is not None


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


def supabase_configured() -> bool:
    return bool(settings.SUPABASE_URL and settings.SUPABASE_KEY)


def get_guardrail_repository_for_gateway() -> GuardrailRepository:
    """The library as the gateway sees it: no user token, so the service role reads it.

    A gateway call authenticates with the deployment's X-API-Key, not a signed-in user, so it
    cannot go through RLS the way the panel does. Same client as app.gateway.resolver.
    """
    if not supabase_configured():
        return InMemoryGuardrailRepository()
    return SupabaseGuardrailRepository(get_supabase())


def get_guardrail_repository(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> GuardrailRepository:
    """FastAPI dependency: the signed-in user's Supabase view, or memory without Supabase."""
    if not supabase_configured():
        return InMemoryGuardrailRepository()
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to use guardrails",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return SupabaseGuardrailRepository(get_supabase_for_user(credentials.credentials))
