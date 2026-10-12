"""Where guardrail bindings are stored: each user's own bindings in Supabase.

Mirrors app.guardrails.repository: queries run as the signed-in user, and routes only talk to
`BindingRepository`, so tests can swap in a fake.
"""

from collections.abc import Callable
from typing import Any, Protocol, TypeVar

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.bindings.models import Binding, ScopeType
from app.core.auth import Me
from supabase import Client

TABLE = "rule_bindings"
_COLUMNS = "id,scope_type,scope_id,guardrail_id,order_index,enabled"

T = TypeVar("T")


class BindingRepository(Protocol):
    def list(
        self, scope_type: ScopeType | None = None, scope_id: str | None = None
    ) -> list[Binding]: ...

    def get(self, binding_id: str) -> Binding | None: ...

    def find(self, scope_type: ScopeType, scope_id: str, guardrail_id: str) -> Binding | None: ...

    def add(self, binding: Binding) -> None: ...

    def replace(self, binding: Binding) -> None: ...

    def delete(self, binding_id: str) -> bool: ...

    def delete_for_guardrail(self, guardrail_id: str) -> None: ...


def to_row(binding: Binding) -> dict[str, Any]:
    return binding.model_dump(mode="json")


class SupabaseBindingRepository:
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
                    status.HTTP_409_CONFLICT,
                    "This guardrail is already attached to that scope",
                ) from error
            if code == "23503":
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Guardrail not found") from error
            if code in {"22001", "22P02", "23502", "23514"}:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "Binding data violates database constraints",
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Binding storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Binding storage is unavailable"
            ) from error

    @staticmethod
    def _from_row(row: Any) -> Binding:
        try:
            return Binding.model_validate(row)
        except ValidationError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Stored binding is invalid"
            ) from error

    def list(
        self, scope_type: ScopeType | None = None, scope_id: str | None = None
    ) -> list[Binding]:
        def query() -> Any:
            request = self._client.table(TABLE).select(_COLUMNS)
            if scope_type is not None:
                request = request.eq("scope_type", scope_type)
            if scope_id is not None:
                request = request.eq("scope_id", scope_id)
            return request.order("order_index").order("position").execute()

        return [self._from_row(row) for row in self._run(query).data]

    def get(self, binding_id: str) -> Binding | None:
        response = self._run(
            lambda: (
                self._client.table(TABLE).select(_COLUMNS).eq("id", binding_id).limit(1).execute()
            )
        )
        return self._from_row(response.data[0]) if response.data else None

    def find(self, scope_type: ScopeType, scope_id: str, guardrail_id: str) -> Binding | None:
        response = self._run(
            lambda: (
                self._client.table(TABLE)
                .select(_COLUMNS)
                .eq("scope_type", scope_type)
                .eq("scope_id", scope_id)
                .eq("guardrail_id", guardrail_id)
                .limit(1)
                .execute()
            )
        )
        return self._from_row(response.data[0]) if response.data else None

    def add(self, binding: Binding) -> None:
        self._run(lambda: self._client.table(TABLE).insert(to_row(binding)).execute())

    def replace(self, binding: Binding) -> None:
        row = to_row(binding)
        del row["id"]
        self._run(lambda: self._client.table(TABLE).update(row).eq("id", binding.id).execute())

    def delete(self, binding_id: str) -> bool:
        response = self._run(
            lambda: self._client.table(TABLE).delete().eq("id", binding_id).execute()
        )
        return bool(response.data)

    def delete_for_guardrail(self, guardrail_id: str) -> None:
        # Postgres cascades this on its own; kept so the fake in tests behaves the same.
        self._run(
            lambda: self._client.table(TABLE).delete().eq("guardrail_id", guardrail_id).execute()
        )


def get_binding_repository(user: Me) -> BindingRepository:
    """FastAPI dependency: the signed-in user's bindings."""
    return SupabaseBindingRepository(user.client)
