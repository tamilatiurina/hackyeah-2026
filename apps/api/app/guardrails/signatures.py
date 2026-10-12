"""Each user's prompt-injection signatures (the prompt_injection template matches them).

The panel reads and edits them as the signed-in user (RLS: own rows only). The gateway has no
signed-in user, so it reads the agent owner's list through gateway_agent_signatures, which
answers only to a caller holding the agent's key.
"""

from collections.abc import Callable
from typing import Any, Protocol, TypeVar

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.core.auth import Me
from app.gateway.keys import hash_key
from app.guardrails.models import InjectionSignature
from supabase import Client

TABLE = "injection_signatures"
_COLUMNS = "id,regex"

T = TypeVar("T")


class SignatureRepository(Protocol):
    def list(self) -> list[InjectionSignature]: ...

    def add(self, signature: InjectionSignature) -> None:
        """Raises 409 when the id is taken."""
        ...

    def delete(self, signature_id: str) -> bool: ...


def _parse(rows: Any) -> list[InjectionSignature]:
    try:
        return [InjectionSignature.model_validate(row) for row in rows or []]
    except ValidationError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "A stored injection signature is invalid"
        ) from error


class SupabaseSignatureRepository:
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
                    status.HTTP_409_CONFLICT, "A signature with this id already exists"
                ) from error
            if code in {"22001", "22P02", "23502", "23514"}:
                raise HTTPException(
                    status.HTTP_422_UNPROCESSABLE_CONTENT,
                    "Signature data violates database constraints",
                ) from error
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Signature storage is unavailable"
            ) from error
        except httpx.HTTPError as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Signature storage is unavailable"
            ) from error

    def list(self) -> list[InjectionSignature]:
        response = self._run(
            lambda: self._client.table(TABLE).select(_COLUMNS).order("position").execute()
        )
        return _parse(response.data)

    def add(self, signature: InjectionSignature) -> None:
        self._run(
            lambda: self._client.table(TABLE).insert(signature.model_dump(mode="json")).execute()
        )

    def delete(self, signature_id: str) -> bool:
        response = self._run(
            lambda: self._client.table(TABLE).delete().eq("id", signature_id).execute()
        )
        return bool(response.data)


def get_signature_repository(user: Me) -> SignatureRepository:
    """FastAPI dependency: the signed-in user's signatures."""
    return SupabaseSignatureRepository(user.client)


class SignatureLoader(Protocol):
    def load(self, agent_id: str, key: str) -> list[InjectionSignature]:
        """The agent owner's signatures; `key` is the agent's gateway key."""
        ...


class GatewaySignatureLoader:
    """Calls gateway_agent_signatures (see the per_user_ownership migration)."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def load(self, agent_id: str, key: str) -> list[InjectionSignature]:
        params = {"p_agent_id": agent_id, "p_key_hash": hash_key(key)}
        try:
            response = self._client.rpc("gateway_agent_signatures", params).execute()
        except (APIError, httpx.HTTPError) as error:
            # Fail closed, like the policy loader: no call goes out with its checks half loaded.
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway could not load the signatures"
            ) from error
        return _parse(response.data if isinstance(response.data, list) else [])
