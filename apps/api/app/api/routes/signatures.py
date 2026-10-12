from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.guardrails.models import InjectionSignature
from app.guardrails.signatures import SignatureRepository, get_signature_repository

router = APIRouter(tags=["injection-signatures"])

Repo = Annotated[SignatureRepository, Depends(get_signature_repository)]


@router.get("/injection-signatures")
def list_signatures(repo: Repo) -> list[InjectionSignature]:
    return repo.list()


@router.post("/injection-signatures", status_code=status.HTTP_201_CREATED)
def add_signature(body: InjectionSignature, repo: Repo) -> InjectionSignature:
    repo.add(body)
    return body


@router.delete("/injection-signatures/{signature_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_signature(signature_id: str, repo: Repo) -> Response:
    if not repo.delete(signature_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signature not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)
