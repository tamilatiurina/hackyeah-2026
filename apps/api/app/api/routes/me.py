"""The signed-in user's first-sign-in setup.

POST /me/bootstrap is called by the panel after every sign-in and does each step once:

1. Copy the seed guardrails and injection signatures (app.seeds) into the user's own library.
2. Register the shared demo agent as one of the user's agents. If its Agent Card can't be read
   (the demo agent is down, or runs on a private address locally), the step is retried at the
   next sign-in. A user who deletes the demo agent does not get it back.
"""

import logging
from typing import Annotated, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, HttpUrl

from app.api.routes.agents.deps import AgentDatabase, get_agent_database, get_http_client
from app.api.routes.agents.models import AgentRegistration
from app.api.routes.agents.router import create_agent
from app.core.config import settings
from app.guardrails.repository import GuardrailRepository, get_guardrail_repository
from app.guardrails.signatures import SignatureRepository, get_signature_repository
from app.profiles import ProfileRepository, get_profile_repository
from app.seeds import seed_guardrails, seed_signatures

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/me", tags=["me"])

DEMO_AGENT_PATH = "demo-agent"


class Bootstrap(BaseModel):
    library: Literal["seeded", "already_seeded"]
    demo_agent: Literal["added", "already_added", "unavailable"]


def demo_agent_url(request: Request) -> str:
    """settings.DEMO_AGENT_URL, else the demo-agent service on the request's own domain."""
    return settings.DEMO_AGENT_URL or f"{request.base_url}{DEMO_AGENT_PATH}"


def _seed_library(guardrails: GuardrailRepository, signatures: SignatureRepository) -> None:
    """Add every seed the user doesn't have yet (ids are per user, so a retry can't clash)."""
    for guardrail in seed_guardrails():
        if guardrails.get(guardrail.id) is None:
            guardrails.add(guardrail)
    existing = {signature.id for signature in signatures.list()}
    for signature in seed_signatures():
        if signature.id not in existing:
            signatures.add(signature)


@router.post("/bootstrap")
async def bootstrap(
    request: Request,
    profile: Annotated[ProfileRepository, Depends(get_profile_repository)],
    guardrails: Annotated[GuardrailRepository, Depends(get_guardrail_repository)],
    signatures: Annotated[SignatureRepository, Depends(get_signature_repository)],
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
    client: Annotated[httpx.AsyncClient, Depends(get_http_client)],
) -> Bootstrap:
    done = await run_in_threadpool(profile.done)

    library: Literal["seeded", "already_seeded"] = "already_seeded"
    if "bootstrapped_at" not in done:
        await run_in_threadpool(_seed_library, guardrails, signatures)
        await run_in_threadpool(profile.mark, "bootstrapped_at")
        library = "seeded"

    demo: Literal["added", "already_added", "unavailable"] = "already_added"
    if "demo_agent_added_at" not in done:
        registration = AgentRegistration(base_url=HttpUrl(demo_agent_url(request)))
        try:
            await create_agent(registration, client, database)
            demo = "added"
        except HTTPException as error:
            if error.status_code != status.HTTP_409_CONFLICT:  # 409: already registered
                logger.warning("Could not add the demo agent: %s", error.detail)
                return Bootstrap(library=library, demo_agent="unavailable")
        await run_in_threadpool(profile.mark, "demo_agent_added_at")
    return Bootstrap(library=library, demo_agent=demo)
