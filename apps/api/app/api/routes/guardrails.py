from typing import Annotated
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.bindings.repository import BindingRepository, get_binding_repository
from app.guardrails.evaluate import PatternTimeoutError, evaluate
from app.guardrails.judge import Judge, JudgeUnavailableError, get_judge
from app.guardrails.models import (
    TEMPLATES,
    DryRunRequest,
    DryRunResult,
    Guardrail,
    GuardrailCreate,
    GuardrailUpdate,
    TemplateInfo,
)
from app.guardrails.repository import GuardrailRepository, get_guardrail_repository
from app.guardrails.signatures import SignatureRepository, get_signature_repository

router = APIRouter(tags=["guardrails"])

Repo = Annotated[GuardrailRepository, Depends(get_guardrail_repository)]
Bindings = Annotated[BindingRepository, Depends(get_binding_repository)]
Signatures = Annotated[SignatureRepository, Depends(get_signature_repository)]
JudgeDep = Annotated[Judge | None, Depends(get_judge)]


def _get_or_404(repo: GuardrailRepository, guardrail_id: str) -> Guardrail:
    guardrail = repo.get(guardrail_id)
    if guardrail is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guardrail not found")
    return guardrail


@router.get("/guardrail-templates")
def list_templates() -> list[TemplateInfo]:
    return list(TEMPLATES.values())


@router.get("/guardrails")
def list_guardrails(repo: Repo) -> list[Guardrail]:
    return repo.list()


@router.post("/guardrails", status_code=status.HTTP_201_CREATED)
def create_guardrail(body: GuardrailCreate, repo: Repo) -> Guardrail:
    guardrail = Guardrail(id=f"gr-{uuid4().hex[:8]}", **body.model_dump())
    repo.add(guardrail)
    return guardrail


@router.post("/guardrails/dry-run")
def dry_run(body: DryRunRequest, judge: JudgeDep, signatures: Signatures) -> DryRunResult:
    try:
        return evaluate(body, body.text, signatures.list(), judge=judge)
    except JudgeUnavailableError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"The LLM judge is unavailable ({e}); try again",
        ) from e
    except PatternTimeoutError as e:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Pattern took too long to run on this text",
        ) from e


@router.get("/guardrails/{guardrail_id}")
def get_guardrail(guardrail_id: str, repo: Repo) -> Guardrail:
    return _get_or_404(repo, guardrail_id)


@router.patch("/guardrails/{guardrail_id}")
def update_guardrail(
    guardrail_id: str, body: GuardrailUpdate, repo: Repo, bindings: Bindings
) -> Guardrail:
    current = _get_or_404(repo, guardrail_id)
    updated = current.model_copy(update=body.model_dump(exclude_unset=True))
    repo.replace(updated)
    if updated.is_mandatory and not current.is_mandatory:
        # It now applies to all of the owner's agents, so per-scope attachments are redundant.
        bindings.delete_for_guardrail(guardrail_id)
    return updated


@router.delete("/guardrails/{guardrail_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_guardrail(guardrail_id: str, repo: Repo, bindings: Bindings) -> Response:
    if not repo.delete(guardrail_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Guardrail not found")
    bindings.delete_for_guardrail(guardrail_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
