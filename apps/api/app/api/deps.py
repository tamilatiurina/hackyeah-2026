from datetime import UTC, datetime
from typing import Annotated

from fastapi import Header, HTTPException, status

from app.core.supabase import get_supabase as _get_supabase
from supabase import Client


def get_timestamp() -> str:
    """Return the current UTC timestamp in ISO 8601 format."""
    return datetime.now(UTC).isoformat()


def get_supabase() -> Client:
    """FastAPI dependency returning the shared Supabase client."""
    return _get_supabase()


def require_admin(x_role: Annotated[str | None, Header()] = None) -> None:
    """Stand-in for real auth (A-08): trusts the X-Role header sent by the panel."""
    if x_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only admins can change injection signatures",
        )


def get_role(x_role: Annotated[str | None, Header()] = None) -> str | None:
    """The caller's role as claimed by the panel (stand-in for real auth, A-08)."""
    return x_role
