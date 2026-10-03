"""Minimal policy editor page served by the backend (no frontend build step).

Single Jinja2 template + inline CSS/vanilla JS. Talks to /api/v1/pi/policy.
"""

from pathlib import Path

from fastapi import Request, Response
from fastapi.templating import Jinja2Templates

_templates = Jinja2Templates(directory=str(Path(__file__).resolve().parents[3] / "templates"))


def render_ui(request: Request) -> Response:
    return _templates.TemplateResponse(request, "pi_policy_editor.html")
