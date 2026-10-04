"""SEC-01: run the OWASP LLM Top 10 attack pack against an agent, and read past scans.

POST streams NDJSON so the panel can show progress: a `start` event, one `probe` event per
result as it finishes, then `summary` with the saved scan (or `error` if it couldn't be saved).
"""

import json
import logging
import secrets
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from postgrest.exceptions import APIError
from pydantic import BaseModel

from app.api.deps import get_role
from app.api.routes.agents.deps import AgentDatabase, get_agent_database
from app.api.routes.agents.target import load_upstream_target
from app.bindings.repository import BindingRepository, get_binding_repository
from app.bindings.resolve import resolve_for_request
from app.gateway.pipeline import GuardrailEngine
from app.gateway.service import get_gateway_http_client, get_guardrail_engine
from app.guardrails.judge import Judge, get_judge
from app.guardrails.repository import GuardrailRepository, get_guardrail_repository
from app.security.models import ProbeResult, ScanListItem, ScanRecord
from app.security.probes import CATEGORIES, PROBES
from app.security.repository import scan_repository
from app.security.runner import run_scan, static_checks, summarize

logger = logging.getLogger(__name__)

router = APIRouter(tags=["security"])

Database = Annotated[AgentDatabase, Depends(get_agent_database)]


def _line(event: BaseModel | dict[str, object]) -> bytes:
    if isinstance(event, BaseModel):
        return (event.model_dump_json(by_alias=True) + "\n").encode()
    return (json.dumps(event, default=str) + "\n").encode()


@router.post("/agents/{agent_id}/security-scans")
async def start_security_scan(
    agent_id: UUID,
    database: Database,
    guardrails: Annotated[GuardrailRepository, Depends(get_guardrail_repository)],
    bindings: Annotated[BindingRepository, Depends(get_binding_repository)],
    role: Annotated[str | None, Depends(get_role)],
    engine: Annotated[GuardrailEngine, Depends(get_guardrail_engine)],
    client: Annotated[httpx.AsyncClient, Depends(get_gateway_http_client)],
    judge: Annotated[Judge | None, Depends(get_judge)],
) -> StreamingResponse:
    # Before streaming, so a missing agent is a plain 404 and not a broken stream.
    target = await run_in_threadpool(load_upstream_target, database, agent_id)
    policy = await run_in_threadpool(
        resolve_for_request, guardrails, bindings, str(agent_id), role, database.owner_id
    )
    scan_id = str(uuid4())
    checks = static_checks(target)
    canary = f"GH-{secrets.token_hex(4).upper()}"

    async def events() -> AsyncIterator[bytes]:
        yield _line(
            {
                "type": "start",
                "scanId": scan_id,
                "agentId": str(agent_id),
                "total": len(PROBES),
                "probes": [
                    {"probeId": p.id, "category": p.category, "title": p.title} for p in PROBES
                ],
                "judge": judge is not None,
                "categories": [c.model_dump(by_alias=True) for c in CATEGORIES],
                "staticChecks": [c.model_dump(by_alias=True) for c in checks],
            }
        )
        results: list[ProbeResult] = []
        async for result in run_scan(
            agent_id=str(agent_id),
            target=target,
            policy=policy,
            engine=engine,
            client=client,
            judge=judge,
            role=role,
            canary=canary,
        ):
            results.append(result)
            yield _line({"type": "probe", "result": result.model_dump(by_alias=True)})

        order = {p.id: i for i, p in enumerate(PROBES)}
        results.sort(key=lambda r: order.get(r.probe_id, len(order)))
        scan = ScanRecord(
            id=scan_id,
            agent_id=str(agent_id),
            created_at=datetime.now(UTC),
            policy_version=policy.version,
            summary=summarize(results),
            categories=CATEGORIES,
            static_checks=checks,
            results=results,
        )
        try:
            await run_in_threadpool(scan_repository(database.client).save, scan)
        except (APIError, httpx.HTTPError):
            logger.warning("Could not save security scan %s", scan_id, exc_info=True)
            yield _line({"type": "error", "message": "The scan finished but couldn't be saved"})
        yield _line({"type": "summary", "scan": scan.model_dump(mode="json", by_alias=True)})

    return StreamingResponse(events(), media_type="application/x-ndjson")


@router.get(
    "/agents/{agent_id}/security-scans",
    response_model=list[ScanListItem],
    response_model_by_alias=True,
)
async def list_security_scans(agent_id: UUID, database: Database) -> list[ScanListItem]:
    await run_in_threadpool(load_upstream_target, database, agent_id)  # 404 if not the owner's
    try:
        return await run_in_threadpool(
            scan_repository(database.client).list_for_agent, str(agent_id)
        )
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Could not load scans") from error


@router.get("/security-scans/{scan_id}", response_model=ScanRecord, response_model_by_alias=True)
async def get_security_scan(scan_id: UUID, database: Database) -> ScanRecord:
    try:
        scan = await run_in_threadpool(scan_repository(database.client).get, str(scan_id))
    except (APIError, httpx.HTTPError) as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Could not load the scan"
        ) from error
    if scan is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scan not found")
    # Supabase RLS already hides other owners' scans; this also covers the in-memory store.
    await run_in_threadpool(load_upstream_target, database, UUID(scan.agent_id))
    return scan
