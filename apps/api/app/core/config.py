import os
from pathlib import Path
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict

_API_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[4]


def _default_state_dir() -> str:
    """Local: the repo's .pi dir. Serverless (Vercel): /tmp/pi-state (writable).

    Everything mutable — policy, incidents, sessions, sandbox config — lives
    under one state dir, because serverless filesystems are read-only except
    /tmp and wiped between cold starts. The repo seed policy is copied there
    on first use (see app.pi_policy.state.ensure_state).
    """
    if Path("/tmp/.vercel").exists() or os.environ.get("VERCEL"):
        return "/tmp/pi-state"
    return str(_REPO_ROOT / ".pi")


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_API_ROOT / ".env",
        env_ignore_empty=True,
        extra="ignore",
    )

    PROJECT_NAME: str = "Vercel + FastAPI"
    VERSION: str = "1.0.0"
    API_V1_STR: str = "/api/v1"
    SUPABASE_URL: str = ""
    SUPABASE_KEY: str = ""

    # LLM judge engine (E-02). Without a key, llm_judge verdicts are simulated heuristics.
    ANTHROPIC_API_KEY: str = ""
    JUDGE_MODEL: str = "claude-haiku-4-5"
    JUDGE_TIMEOUT_S: float = 8.0

    # pi control layer policy. POLICY_PATH anchors to the state dir (repo/.pi
    # locally, /tmp/pi-state on Vercel); the seed policy lives in the repo and
    # is copied into the state dir on first use.
    POLICY_PATH: str = str(Path(_default_state_dir()) / "policy.json")
    POLICY_SCHEMA_PATH: str = str(
        _REPO_ROOT / "packages" / "pi-control-layer" / "policy.schema.json"
    )
    # vendored fallback (Vercel build copies packages/pi-control-layer into the
    # project dir, because the repo packages dir is not part of the upload)
    POLICY_SCHEMA_PATH_VERCEL: str = str(_API_ROOT / "pi-control-layer" / "policy.schema.json")
    POLICY_MAX_BACKUPS: int = 10

    # pi playground
    REPO_ROOT: str = str(_REPO_ROOT)
    # base URL the playground advertises for its served pages (the pi agent fetches it)
    PLAYGROUND_BASE_URL: str = "http://127.0.0.1:8000"
    INCIDENTS_PATH: str = str(Path(_default_state_dir()) / "incidents.json")
    # where pi stores its session files (empty = pi's own default ~/.pi/agent/sessions;
    # on Vercel this must point into the state dir because $HOME is not writable)
    PI_SESSIONS_DIR: str = ""

    # pi binary. Empty = shutil.which("pi") (local installs). On Vercel the build
    # step installs the npm package under apps/api/node_modules and this points
    # at its cli.js.
    PI_COMMAND: str = ""

    # B-05 (FR-25, FR-26): limits the gateway enforces on every guarded call. A cap of 0
    # switches that limit off. Each one blocks or only warns when it is exceeded. Per-session
    # caps add up the calls of one A2A contextId. Prices: app/gateway/limits.py.
    CALL_TIMEOUT_SECONDS: float = 30.0
    MAX_CALL_TOKENS: int = 8_000
    CALL_TOKENS_ACTION: Literal["block", "warn"] = "block"
    MAX_CALL_COST_USD: float = 0.05
    CALL_COST_ACTION: Literal["block", "warn"] = "warn"
    MAX_SESSION_TOKENS: int = 50_000
    SESSION_TOKENS_ACTION: Literal["block", "warn"] = "block"
    MAX_SESSION_COST_USD: float = 0.50
    SESSION_COST_ACTION: Literal["block", "warn"] = "block"


settings = Settings()
