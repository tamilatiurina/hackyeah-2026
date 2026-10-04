"""Serverless state bootstrap.

On Vercel the deployment filesystem is read-only except /tmp, and every cold
start starts fresh. This module makes the pi stack work there:

- the repo's seed policy is copied into the state dir on first use, so policy
  reads/writes, auto-bans and incidents have a writable home
- pi is told (via env) to keep its config and sessions in the state dir too
- the pi binary from the npm install (build step) is discovered

Local runs keep using the repo `.pi/` and a system-installed `pi`; the same
code path works for both.
"""

import json
import os
import shutil
from pathlib import Path

from app.core.config import settings

_STATE_DIR = Path(settings.POLICY_PATH).parent
_VERCEL = Path("/tmp/.vercel").exists() or bool(os.environ.get("VERCEL"))

# npm package layout: node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js
_PI_NPM_DIR = (
    Path(settings.REPO_ROOT)
    / "apps"
    / "api"
    / "node_modules"
    / "@earendil-works"
    / "pi-coding-agent"
)


def ensure_state() -> Path:
    """Idempotent: seed policy + incidents home under the state dir."""
    _STATE_DIR.mkdir(parents=True, exist_ok=True)
    policy = Path(settings.POLICY_PATH)
    if not policy.exists():
        schema_dir = Path(settings.POLICY_SCHEMA_PATH).parent
        candidates = (
            schema_dir / "policy.json.example",  # repo layout (local)
            # vendored (Vercel)
            Path(settings.REPO_ROOT) / "pi-control-layer" / "policy.json.example",
        )
        seed = next((c for c in candidates if c.exists()), None)
        if seed is not None:
            shutil.copy(seed, policy)
            try:
                json.loads(policy.read_text(encoding="utf-8"))  # sanity
            except json.JSONDecodeError:
                policy.unlink(missing_ok=True)
                raise
    return _STATE_DIR


def schema_path() -> str:
    """Schema location: repo packages dir, or the vendored copy (Vercel build)."""
    repo = Path(settings.POLICY_SCHEMA_PATH)
    if repo.is_file():
        return str(repo)
    vendored = settings.POLICY_SCHEMA_PATH_VERCEL
    if Path(vendored).is_file():
        return vendored
    return str(repo)


def pi_command() -> list[str] | None:
    """pi as an argv list: PI_COMMAND override, npm-installed cli.js, then PATH."""
    if settings.PI_COMMAND:
        return settings.PI_COMMAND.split()
    bundled = _PI_NPM_DIR / "dist" / "bundle" / "cli.js"
    if bundled.is_file():
        node = shutil.which("node")
        if node is None:
            return None
        return [node, str(bundled)]
    pi = shutil.which("pi")
    return [pi] if pi else None


def pi_env() -> dict[str, str]:
    """Env for pi subprocesses: keep config + sessions inside the state dir."""
    env: dict[str, str] = {}
    if _VERCEL or settings.PI_SESSIONS_DIR:
        agent_dir = _STATE_DIR / "agent"
        agent_dir.mkdir(parents=True, exist_ok=True)
        env["PI_CODING_AGENT_DIR"] = str(agent_dir)
        env["PI_CODING_AGENT_SESSION_DIR"] = str(agent_dir / "sessions")
        (agent_dir / "sessions").mkdir(parents=True, exist_ok=True)
    return env
