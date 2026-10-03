"""FR-05: attach and detach guardrails on agents, roles and users, and set their order."""

from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.bindings.models import Binding, BindingCreate, BindingUpdate, EffectivePolicy, ScopeType
from app.bindings.repository import BindingRepository, get_binding_repository
from app.bindings.resolve import resolve_for_request
from app.guardrails.repository import GuardrailRepository, get_guardrail_repository

router = APIRouter(tags=["bindings"])

Bindings = Annotated[BindingRepository, Depends(get_binding_repository)]
Guardrails = Annotated[GuardrailRepository, Depends(get_guardrail_repository)]


def _get_or_404(repo: BindingRepository, binding_id: str) -> Binding:
    binding = repo.get(binding_id)
    if binding is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Binding not found")
    return binding


@router.post("/bindings", status_code=status.HTTP_201_CREATED)
def attach_guardrail(body: BindingCreate, repo: Bindings, guardrails: Guardrails) -> Binding:
    guardrail = guardrails.get(body.guardrail_id)
    if guardrail is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guardrail not found")
    if guardrail.is_mandatory:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Mandatory guardrails already apply everywhere and cannot be attached",
        )
    if repo.find(body.scope_type, body.scope_id, body.guardrail_id) is not None:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This guardrail is already attached to that scope"
        )
    binding = Binding(id=f"rb-{uuid4().hex[:8]}", **body.model_dump())
    repo.add(binding)
    return binding


@router.get("/bindings")
def list_bindings(
    repo: Bindings,
    scope_type: Annotated[ScopeType | None, Query()] = None,
    scope_id: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    guardrail_id: Annotated[str | None, Query(min_length=1, max_length=60)] = None,
) -> list[Binding]:
    bindings = repo.list(scope_type, scope_id)
    if guardrail_id is not None:
        bindings = [b for b in bindings if b.guardrail_id == guardrail_id]
    return bindings


def _refuse_if_mandatory(binding: Binding, guardrails: GuardrailRepository, verb: str) -> None:
    """FR-06: a mandatory guardrail is not an attachment, so it cannot be changed as one."""
    guardrail = guardrails.get(binding.guardrail_id)
    if guardrail is not None and guardrail.is_mandatory:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Mandatory guardrails cannot be {verb}")


@router.patch("/bindings/{binding_id}")
def update_binding(
    binding_id: str, body: BindingUpdate, repo: Bindings, guardrails: Guardrails
) -> Binding:
    current = _get_or_404(repo, binding_id)
    _refuse_if_mandatory(current, guardrails, "reordered or paused")
    updated = current.model_copy(update=body.model_dump(exclude_unset=True))
    repo.replace(updated)
    return updated


@router.delete("/bindings/{binding_id}", status_code=status.HTTP_204_NO_CONTENT)
def detach_guardrail(binding_id: str, repo: Bindings, guardrails: Guardrails) -> Response:
    current = repo.get(binding_id)
    if current is not None:
        _refuse_if_mandatory(current, guardrails, "detached")
    if not repo.delete(binding_id):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Binding not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/effective-guardrails")
def get_effective_guardrails(
    repo: Bindings,
    guardrails: Guardrails,
    agent_id: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    role: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    user_id: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
) -> EffectivePolicy:
    """What the gateway runs for this agent, called by this role and this user.

    With no parameters it returns the mandatory guardrails only: the floor every request
    gets even when nothing is attached.
    """
    return resolve_for_request(guardrails, repo, agent_id=agent_id, role=role, user_id=user_id)
