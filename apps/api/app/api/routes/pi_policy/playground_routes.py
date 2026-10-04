"""Endpoints for the pi playground (tag: pi-playground).

Predefined, sandboxed scenarios run through `pi -p` with the control-layer
extension, so a reviewer can watch policy enforcement live. See
`app/pi_policy/playground.py` for the safety rules.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel

from app.pi_policy.playground import (
    PlaygroundError,
    RunRequest,
    RunResult,
    injection_page,
    list_scenarios,
    reset_sandbox,
    run_scenario,
)
from app.pi_policy.service import PolicyFileService, get_policy_service

router = APIRouter(prefix="/pi/playground", tags=["pi-playground"])

Service = Annotated[PolicyFileService, Depends(get_policy_service)]


class HostOption(BaseModel):
    id: str
    label: str


class ScenarioOut(BaseModel):
    id: str
    title: str
    prompt: str
    expected: str
    hint: str


@router.get("/scenarios")
def get_scenarios() -> list[ScenarioOut]:
    return [ScenarioOut(**s.__dict__) for s in list_scenarios()]


@router.get("/hosts")
def get_hosts(service: Service) -> list[HostOption]:
    """Hosts selectable for a simulated run: global defaults + every policy agent."""
    try:
        policy, _ = service.read()
    except Exception:  # noqa: BLE001 — the page must render even if the policy file is broken
        policy = {}
    options = [HostOption(id="playground-global", label="Global (defaults)")]
    options += [HostOption(id=name, label=name) for name in (policy.get("agents") or {})]
    return options


@router.get("/injection-page", response_class=PlainTextResponse)
def get_injection_page() -> str:
    """The deliberately malicious (but harmless) page for the injection scenario."""
    return injection_page()


@router.post("/run")
def run(body: RunRequest) -> RunResult:
    try:
        return run_scenario(body)
    except PlaygroundError as e:
        raise HTTPException(e.status_code, detail=str(e)) from e
    except Exception as e:  # noqa: BLE001 — surface subprocess failures to the UI
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Run failed: {e}") from e


@router.post("/reset-sandbox")
def reset() -> dict[str, object]:
    """Re-stage the demo sandbox: restores files a passing destructive scenario removed."""
    try:
        staged = reset_sandbox()
    except PlaygroundError as e:
        raise HTTPException(e.status_code, detail=str(e)) from e
    return {"staged": staged, "sandboxDir": staged[0].rsplit("/", 1)[0] if staged else ""}
