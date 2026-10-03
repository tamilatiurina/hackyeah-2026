from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.api.deps import require_admin
from app.guardrails.models import InjectionSignature
from app.store import store

router = APIRouter(tags=["injection-signatures"])
admin_only = [Depends(require_admin)]


@router.get("/injection-signatures")
def list_signatures() -> list[InjectionSignature]:
    return list(store.signatures.values())


@router.post("/injection-signatures", status_code=status.HTTP_201_CREATED, dependencies=admin_only)
def add_signature(body: InjectionSignature) -> InjectionSignature:
    if body.id in store.signatures:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="A signature with this id already exists"
        )
    store.signatures[body.id] = body
    return body


@router.delete(
    "/injection-signatures/{signature_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=admin_only,
)
def delete_signature(signature_id: str) -> Response:
    if signature_id not in store.signatures:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Signature not found")
    del store.signatures[signature_id]
    return Response(status_code=status.HTTP_204_NO_CONTENT)
