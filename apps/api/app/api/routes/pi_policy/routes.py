"""Endpoints for the pi control layer policy file (tag: pi-policy).

Reads, validates and atomically updates the `policy.json` consumed by the pi
`control-layer.ts` extension. See `app/pi_policy/service.py` for the file
mechanics and `policy.schema.json` for the format.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel

from app.api.routes.pi_policy.ui import render_ui
from app.pi_policy.service import (
    PolicyError,
    PolicyFileNotFound,
    PolicyFileService,
    PolicyInvalid,
    PolicyStaleError,
    ValidationErrorInfo,
    get_policy_service,
)

router = APIRouter(prefix="/pi", tags=["pi-policy"])

Service = Annotated[PolicyFileService, Depends(get_policy_service)]


class PolicyDocument(BaseModel):
    policy: dict[str, object]


class PolicyWithMeta(PolicyDocument):
    path: str
    lastModifiedUtc: str | None
    sha256: str | None
    sizeBytes: int | None


class ValidationResult(BaseModel):
    valid: bool
    errors: list[ValidationErrorInfo]


@router.get("/policy")
def get_policy(service: Service, response: Response) -> PolicyWithMeta:
    try:
        policy, meta = service.read()
    except PolicyFileNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except PolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from e
    if meta.sha256:
        response.headers["ETag"] = f'"{meta.sha256}"'
    return PolicyWithMeta(policy=policy, **meta.as_dict())


@router.put("/policy")
def put_policy(
    body: PolicyDocument,
    service: Service,
    if_match: Annotated[str | None, Header()] = None,
) -> PolicyWithMeta:
    expected = if_match.strip('"') if if_match else None
    try:
        meta = service.write(body.policy, expected_sha256=expected)
    except PolicyInvalid as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "policy does not conform to the schema", "errors": e.errors},
        ) from e
    except PolicyStaleError as e:
        raise HTTPException(
            status.HTTP_412_PRECONDITION_FAILED,
            detail={"message": str(e), "currentSha256": e.current},
        ) from e
    except PolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from e
    return PolicyWithMeta(policy=body.policy, **meta.as_dict())


@router.post("/policy/validate")
def validate_policy(body: PolicyDocument, service: Service) -> ValidationResult:
    errors = service.validate(body.policy)
    return ValidationResult(valid=not errors, errors=errors)


@router.get("/policy/schema")
def get_policy_schema(service: Service) -> dict[str, object]:
    try:
        return service.read_schema()
    except PolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from e


@router.get("/policy/backups")
def list_backups(service: Service) -> list[dict[str, str | int | None]]:
    return service.list_backups()


@router.post("/policy/backups/{backup_id}/restore")
def restore_backup(backup_id: str, service: Service) -> dict[str, object]:
    try:
        meta = service.restore(backup_id)
    except PolicyFileNotFound as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail=str(e)) from e
    except PolicyInvalid as e:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={"message": "backup does not conform to the schema", "errors": e.errors},
        ) from e
    except PolicyError as e:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail=str(e)) from e
    return {"restoredFrom": backup_id, **meta.as_dict()}


@router.get("/policy/ui", include_in_schema=False)
def policy_ui(request: Request, service: Service) -> Response:
    """Minimal backend-served editor page (no frontend build step)."""
    return render_ui(request)
