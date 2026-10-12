"""The signed-in user's profile: what the first-sign-in setup has already done for them."""

from datetime import UTC, datetime
from typing import Literal, Protocol

import httpx
from fastapi import HTTPException, status
from postgrest.exceptions import APIError

from app.core.auth import Me
from supabase import Client

TABLE = "profiles"
Step = Literal["bootstrapped_at", "demo_agent_added_at"]


class ProfileRepository(Protocol):
    def done(self) -> set[Step]:
        """The setup steps already completed for the signed-in user."""
        ...

    def mark(self, step: Step) -> None: ...


class SupabaseProfileRepository:
    """RLS limits the profile table to the caller's own row (per_user_ownership migration)."""

    def __init__(self, client: Client, user_id: str) -> None:
        self._client = client
        self._user_id = user_id

    def done(self) -> set[Step]:
        try:
            response = (
                self._client.table(TABLE)
                .select("bootstrapped_at,demo_agent_added_at")
                .eq("id", self._user_id)
                .limit(1)
                .execute()
            )
        except (APIError, httpx.HTTPError) as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Could not read your profile"
            ) from error
        row = response.data[0] if response.data else {}
        steps: tuple[Step, ...] = ("bootstrapped_at", "demo_agent_added_at")
        return {step for step in steps if isinstance(row, dict) and row.get(step)}

    def mark(self, step: Step) -> None:
        try:
            self._client.table(TABLE).update({step: datetime.now(UTC).isoformat()}).eq(
                "id", self._user_id
            ).execute()
        except (APIError, httpx.HTTPError) as error:
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, "Could not update your profile"
            ) from error


def get_profile_repository(user: Me) -> ProfileRepository:
    return SupabaseProfileRepository(user.client, user.id)
