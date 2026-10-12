"""Who is calling: every panel route runs as one signed-in Supabase user.

The panel sends the user's access token as `Authorization: Bearer <token>`. It is checked with
Supabase Auth, and the user's own Supabase client (that token on every query) is handed to the
repositories, so row-level security limits every read and write to the user's own rows.
"""

from dataclasses import dataclass
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from supabase_auth.errors import AuthApiError

from app.core.supabase import get_supabase_for_user
from supabase import Client

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class CurrentUser:
    id: str
    email: str | None
    client: Client


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"}
    )


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> CurrentUser:
    """FastAPI dependency: the signed-in user, or 401. 503 when Supabase isn't configured."""
    if credentials is None:
        raise _unauthorized("Sign in to continue")
    token = credentials.credentials
    try:
        client = get_supabase_for_user(token)
    except RuntimeError as error:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Database is not configured"
        ) from error
    try:
        response = await run_in_threadpool(client.auth.get_user, token)
    except AuthApiError as error:
        raise _unauthorized("Invalid or expired access token") from error
    user = response.user if response is not None else None
    if user is None or getattr(user, "is_anonymous", False):
        raise _unauthorized("Invalid or expired access token")
    return CurrentUser(id=str(user.id), email=user.email, client=client)


Me = Annotated[CurrentUser, Depends(get_current_user)]
