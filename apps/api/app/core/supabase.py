from functools import lru_cache

from supabase import Client, create_client

from app.core.config import settings


@lru_cache
def get_supabase() -> Client:
    """Return a shared Supabase client built from SUPABASE_URL and SUPABASE_KEY."""
    if not settings.SUPABASE_URL or not settings.SUPABASE_KEY:
        raise RuntimeError("SUPABASE_URL and SUPABASE_KEY must be set")
    return create_client(settings.SUPABASE_URL, settings.SUPABASE_KEY)
