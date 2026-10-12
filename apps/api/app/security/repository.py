"""Where scans are saved: Supabase as the signed-in owner (RLS: their own agents only)."""

from typing import Any, Protocol, cast

from app.core.auth import Me
from app.security.models import ScanListItem, ScanRecord
from supabase import Client

TABLE = "security_scans"
_LIST_COLUMNS = "id,agent_id,created_at,policy_version,summary"
HISTORY_LIMIT = 20


class ScanRepository(Protocol):
    def save(self, scan: ScanRecord) -> None: ...

    def list_for_agent(self, agent_id: str) -> list[ScanListItem]: ...

    def get(self, scan_id: str) -> ScanRecord | None: ...


def _row(scan: ScanRecord) -> dict[str, Any]:
    data = scan.model_dump(mode="json", by_alias=True)
    return {
        "id": scan.id,
        "agent_id": scan.agent_id,
        "created_at": data["createdAt"],
        "policy_version": scan.policy_version,
        "summary": data["summary"],
        "categories": data["categories"],
        "static_checks": data["staticChecks"],
        "results": data["results"],
    }


class SupabaseScanRepository:
    """The owner's own client: RLS limits every read and write to their agents."""

    def __init__(self, client: Client) -> None:
        self._client = client

    def save(self, scan: ScanRecord) -> None:
        self._client.table(TABLE).insert(_row(scan)).execute()

    def list_for_agent(self, agent_id: str) -> list[ScanListItem]:
        response = (
            self._client.table(TABLE)
            .select(_LIST_COLUMNS)
            .eq("agent_id", agent_id)
            .order("created_at", desc=True)
            .limit(HISTORY_LIMIT)
            .execute()
        )
        return [ScanListItem.model_validate(r) for r in cast(list[dict[str, Any]], response.data)]

    def get(self, scan_id: str) -> ScanRecord | None:
        response = self._client.table(TABLE).select("*").eq("id", scan_id).limit(1).execute()
        rows = cast(list[dict[str, Any]], response.data)
        return ScanRecord.model_validate(rows[0]) if rows else None


def get_scan_repository(user: Me) -> ScanRepository:
    """FastAPI dependency: the signed-in owner's scans."""
    return SupabaseScanRepository(user.client)
