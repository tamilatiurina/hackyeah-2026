"""The root vercel.json deploys the API, web panel and landing page as one Services project."""

import json
from pathlib import Path
from typing import Any

from app.main import app

VERCEL_JSON = Path(__file__).resolve().parents[3] / "vercel.json"


def _config() -> dict[str, Any]:
    config: dict[str, Any] = json.loads(VERCEL_JSON.read_text())
    return config


def _service_for(source: str) -> str | None:
    for rewrite in _config()["rewrites"]:
        if rewrite["source"] == source:
            destination = rewrite["destination"]
            return destination.get("service") if isinstance(destination, dict) else None
    return None


def test_api_and_gateway_paths_reach_the_api_before_the_catch_all() -> None:
    sources = [r["source"] for r in _config()["rewrites"]]
    assert _service_for("/api/(.*)") == "api"
    assert _service_for("/a/(.*)") == "api"
    assert sources.index("/api/(.*)") < sources.index("/(.*)")
    assert sources.index("/a/(.*)") < sources.index("/(.*)")
    assert sources[-1] == "/(.*)"


def test_landing_owns_the_root_and_web_owns_everything_else() -> None:
    assert _service_for("/") == "landing"
    assert _service_for("/_astro/(.*)") == "landing"
    assert _service_for("/(.*)") == "web"


def test_web_falls_back_to_index_html_for_deep_links() -> None:
    web = _config()["services"]["web"]
    assert web["root"] == "apps/web"
    assert {"source": "/(.*)", "destination": "/index.html"} in web["rewrites"]


def test_api_entrypoint_is_the_fastapi_app_and_serves_both_public_prefixes() -> None:
    api = _config()["services"]["api"]
    assert api["root"] == "apps/api"
    assert api["entrypoint"] == "app.main:app"
    paths = app.openapi()["paths"]
    assert any(p.startswith("/api/v1/") for p in paths)
    assert any(p.startswith("/a/") for p in paths)


def test_the_demo_agent_is_public_under_demo_agent() -> None:
    demo = _config()["services"]["demo-agent"]
    assert demo["root"] == "apps/agents"
    assert demo["entrypoint"] == "app:app"
    sources = [r["source"] for r in _config()["rewrites"]]
    assert _service_for("/demo-agent/(.*)") == "demo-agent"
    assert sources.index("/demo-agent/(.*)") < sources.index("/(.*)")
