from functools import lru_cache

from app.core.config import settings
from supabase import Client, ClientOptions, create_client


@lru_cache
def get_supabase() -> Client:
    """Return a shared Supabase client built from SUPABASE_URL and SUPABASE_KEY."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)


def get_supabase_for_user(access_token: str) -> Client:
    """Return a request-scoped client whose queries are protected by RLS."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_KEY,
        options=ClientOptions(
            headers={"Authorization": f"Bearer {access_token}"},
            auto_refresh_token=False,
            persist_session=False,
        ),
    )
