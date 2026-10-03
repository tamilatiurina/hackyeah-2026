"""Opaque paging cursors: a JSON list of strings in base64url, so ids may hold any character."""

import base64
import binascii
import json


def encode(parts: list[str]) -> str:
    return base64.urlsafe_b64encode(json.dumps(parts).encode()).decode().rstrip("=")


def decode(cursor: str, size: int) -> list[str]:
    """The cursor's parts; ValueError when it wasn't made by encode() with `size` parts."""
    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        parts = json.loads(raw)
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("Invalid cursor") from error
    if (
        not isinstance(parts, list)
        or len(parts) != size
        or not all(isinstance(p, str) for p in parts)
    ):
        raise ValueError("Invalid cursor")
    return parts
