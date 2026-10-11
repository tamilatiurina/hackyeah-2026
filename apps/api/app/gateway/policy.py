"""Which guardrails the gateway runs for an agent: the mandatory ones plus matching bindings.

The gateway has no signed-in user, so it can't read guardrails through RLS. Like the agent
lookup, it calls a database function that answers only to a caller holding the agent's key,
and only with that agent's owner's guardrails and bindings.
"""

from typing import Any, Protocol

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError
from pydantic import ValidationError

from app.bindings.models import Binding, EffectivePolicy
from app.bindings.resolve import resolve
from app.core.supabase import get_supabase
from app.gateway.keys import hash_key
from app.guardrails.models import Guardrail
from supabase import Client

Json = dict[str, Any]
MAX_SELECTOR_LENGTH = 120


def read_role(call: Json) -> tuple[str | None, bool]:
    """The caller's role, and whether a non-A2A top-level `role` was stripped off `call`.

    Strongest first: `params.metadata.agentsOnRails.role`, then a demo top-level `role`.
    The top-level field is not A2A, so it is removed before the call is forwarded.
    """
    params = call.get("params")
    metadata = params.get("metadata") if isinstance(params, dict) else None
    hub = metadata.get("agentsOnRails") if isinstance(metadata, dict) else None
    hub_role = hub.get("role") if isinstance(hub, dict) else None
    stripped = False
    top_role: Any = None
    if "role" in call:
        top_role = call.pop("role")
        stripped = True

    def _ok(value: Any) -> str | None:
        if not isinstance(value, str):
            return None
        trimmed = value.strip()
        return trimmed if 0 < len(trimmed) <= MAX_SELECTOR_LENGTH else None

    return _ok(hub_role) or _ok(top_role), stripped


class PolicyLoader(Protocol):
    def load(self, agent_id: str, key: str, role: str | None = None) -> EffectivePolicy:
        """The guardrails to run for this agent and role, in order, split by stage."""
        ...


class SupabasePolicyLoader:
    """Calls the gateway_agent_guardrails database function (see its migration)."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def load(self, agent_id: str, key: str, role: str | None = None) -> EffectivePolicy:
        params: dict[str, str] = {"p_agent_id": agent_id, "p_key_hash": hash_key(key)}
        if role is not None:
            params["p_role"] = role
        try:
            response = self._client.rpc("gateway_agent_guardrails", params).execute()
        except (APIError, httpx.HTTPError) as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway could not load the guardrails"
            ) from error

        data: Any = response.data
        if not isinstance(data, dict):  # wrong key: the function returns null
            return resolve([], [], agent_id=agent_id, role=role)
        try:
            guardrails = [Guardrail.model_validate(row) for row in data.get("guardrails") or []]
            bindings = [Binding.model_validate(row) for row in data.get("bindings") or []]
        except ValidationError as error:
            # Fail closed: never forward a call when a stored guardrail can't be understood.
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "A stored guardrail is invalid"
            ) from error
        return resolve(guardrails, bindings, agent_id=agent_id, role=role)


def get_policy_loader() -> PolicyLoader:
    try:
        return SupabasePolicyLoader(get_supabase())
    except RuntimeError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway is not configured"
        ) from error
