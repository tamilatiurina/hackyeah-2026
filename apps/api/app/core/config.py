from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field
from pydantic_settings import BaseSettings, SettingsConfigDict

_API_ROOT = Path(__file__).resolve().parents[2]


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
    # Publishable/anon key only. SUPABASE_KEY wins; otherwise the names the Vercel Supabase
    # integration syncs (and updates on key rotation) are used.
    SUPABASE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices(
            "SUPABASE_KEY", "SUPABASE_PUBLISHABLE_KEY", "SUPABASE_ANON_KEY"
        ),
    )

    # The shared demo agent every new account gets (POST /api/v1/me/bootstrap). Empty: the
    # demo-agent service on the same domain as the request (root vercel.json, /demo-agent).
    DEMO_AGENT_URL: str = ""

    # LLM judge engine (E-02). Without a key, llm_judge verdicts are simulated heuristics.
    ANTHROPIC_API_KEY: str = ""
    JUDGE_MODEL: str = "claude-haiku-4-5"
    JUDGE_TIMEOUT_S: float = 8.0

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
