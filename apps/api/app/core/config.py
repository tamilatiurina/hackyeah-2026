from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

_API_ROOT = Path(__file__).resolve().parents[2]
_REPO_ROOT = Path(__file__).resolve().parents[4]


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

    # pi control layer policy (anchored to the repo root, where the pi
    # extension's project-local lookup <cwd>/.pi/policy.json also points)
    POLICY_PATH: str = str(_REPO_ROOT / ".pi" / "policy.json")
    POLICY_SCHEMA_PATH: str = str(
        _REPO_ROOT / "packages" / "pi-control-layer" / "policy.schema.json"
    )
    POLICY_MAX_BACKUPS: int = 10

    # pi playground
    REPO_ROOT: str = str(_REPO_ROOT)
    # base URL the playground advertises for its served pages (the pi agent fetches it)
    PLAYGROUND_BASE_URL: str = "http://127.0.0.1:8000"
    INCIDENTS_PATH: str = str(_REPO_ROOT / ".pi" / "incidents.json")


settings = Settings()
