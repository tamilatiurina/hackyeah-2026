"""Sessions endpoint (tag: pi-sessions).

Aggregate overview of the pi session files on this machine — counts, costs,
tokens and tool-call stats per session, plus global averages. Transcripts are
never exposed; this page is an inventory, not a log dump.
"""

from fastapi import APIRouter

from app.pi_policy.sessions import read_sessions

router = APIRouter(prefix="/pi/sessions", tags=["pi-sessions"])


@router.get("")
def list_sessions() -> dict[str, object]:
    return read_sessions().as_dict()
