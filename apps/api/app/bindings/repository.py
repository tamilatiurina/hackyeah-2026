"""Where guardrail bindings are stored: Supabase when configured, otherwise the in-memory store.

Mirrors app.guardrails.repository: routes only talk to `BindingRepository`, so they don't
care which one is in use.
"""

from collections.abc import Callable
from typing import Annotated, Any, Protocol, TypeVar

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.bindings.models import Binding, ScopeType
from app.core.supabase import get_supabase, get_supabase_for_user
from app.guardrails.repository import supabase_configured
from app.store import store
from supabase import Client

TABLE = "rule_bindings"
_COLUMNS = "id,scope_type,scope_id,guardrail_id,order_index,enabled"

T = TypeVar("T")

_bearer = HTTPBearer(auto_error=False)


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


class InMemoryBindingRepository:
    """The `store` from app.store (reset before each test)."""

    def list(
        self, scope_type: ScopeType | None = None, scope_id: str | None = None
    ) -> list[Binding]:
        return [
            binding
            for binding in store.bindings.values()
            if (scope_type is None or binding.scope_type == scope_type)
            and (scope_id is None or binding.scope_id == scope_id)
        ]

    def get(self, binding_id: str) -> Binding | None:
        return store.bindings.get(binding_id)

    def find(self, scope_type: ScopeType, scope_id: str, guardrail_id: str) -> Binding | None:
        for binding in store.bindings.values():
            if (
                binding.scope_type == scope_type
                and binding.scope_id == scope_id
                and binding.guardrail_id == guardrail_id
            ):
                return binding
        return None

    def add(self, binding: Binding) -> None:
        store.bindings[binding.id] = binding

    def replace(self, binding: Binding) -> None:
        store.bindings[binding.id] = binding

    def delete(self, binding_id: str) -> bool:
        return store.bindings.pop(binding_id, None) is not None

    def delete_for_guardrail(self, guardrail_id: str) -> None:
        for binding_id in [b.id for b in store.bindings.values() if b.guardrail_id == guardrail_id]:
            del store.bindings[binding_id]


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
        # Postgres cascades this on its own; kept so both repositories behave the same.
        self._run(
            lambda: self._client.table(TABLE).delete().eq("guardrail_id", guardrail_id).execute()
        )


def get_binding_repository_for_gateway() -> BindingRepository:
    """Bindings as the gateway sees them: no user token, so the service role reads them."""
    if not supabase_configured():
        return InMemoryBindingRepository()
    return SupabaseBindingRepository(get_supabase())


def get_binding_repository(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> BindingRepository:
    """FastAPI dependency: the signed-in user's Supabase view, or memory without Supabase."""
    if not supabase_configured():
        return InMemoryBindingRepository()
    if credentials is None:
        raise HTTPException(
            status.HTTP_401_UNAUTHORIZED,
            "Sign in to attach guardrails",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return SupabaseBindingRepository(get_supabase_for_user(credentials.credentials))
