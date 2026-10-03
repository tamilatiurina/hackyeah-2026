from uuid import uuid4

from fastapi import APIRouter, HTTPException, Response, status

from app.guardrails.evaluate import PatternTimeoutError, evaluate
from app.guardrails.models import (
    TEMPLATES,
    DryRunRequest,
    DryRunResult,
    Guardrail,
    GuardrailCreate,
    GuardrailUpdate,
    TemplateInfo,
)
from app.store import store

router = APIRouter(tags=["guardrails"])


def _get_or_404(guardrail_id: str) -> Guardrail:
    guardrail = store.guardrails.get(guardrail_id)
    if guardrail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guardrail not found")
    return guardrail


@router.get("/guardrail-templates")
def list_templates() -> list[TemplateInfo]:
    return list(TEMPLATES.values())


@router.get("/guardrails")
def list_guardrails() -> list[Guardrail]:
    return list(store.guardrails.values())


@router.post("/guardrails", status_code=status.HTTP_201_CREATED)
def create_guardrail(body: GuardrailCreate) -> Guardrail:
    guardrail = Guardrail(id=f"gr-{uuid4().hex[:8]}", **body.model_dump())
    store.guardrails[guardrail.id] = guardrail
    return guardrail


@router.post("/guardrails/dry-run")
def dry_run(body: DryRunRequest) -> DryRunResult:
    try:
        return evaluate(body, body.text, list(store.signatures.values()))
    except PatternTimeoutError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pattern took too long to run on this text",
        ) from e


@router.get("/guardrails/{guardrail_id}")
def get_guardrail(guardrail_id: str) -> Guardrail:
    return _get_or_404(guardrail_id)


@router.patch("/guardrails/{guardrail_id}")
def update_guardrail(guardrail_id: str, body: GuardrailUpdate) -> Guardrail:
    current = _get_or_404(guardrail_id)
    updated = current.model_copy(update=body.model_dump(exclude_unset=True))
    store.guardrails[guardrail_id] = updated
    return updated


@router.delete("/guardrails/{guardrail_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_guardrail(guardrail_id: str) -> Response:
    _get_or_404(guardrail_id)
    del store.guardrails[guardrail_id]
    return Response(status_code=status.HTTP_204_NO_CONTENT)
