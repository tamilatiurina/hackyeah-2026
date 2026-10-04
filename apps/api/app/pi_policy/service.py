"""File-backed policy service for the pi control layer.

Reads, validates and atomically writes the `policy.json` consumed by the pi
`control-layer.ts` extension. The JSON schema in `packages/pi-control-layer`
is the single source of truth for the policy format.
"""

import json
import os
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass
from datetime import UTC, datetime
from hashlib import sha256
from pathlib import Path

from jsonschema import Draft7Validator
from pydantic import BaseModel

from app.core.config import settings

_BACKUP_SUFFIX = ".bak-"
_BACKUP_ID = re.compile(r"^\d{8}T\d{6}Z(?:-\d+)?$")


class PolicyError(Exception):
    """Base error for policy file operations."""


class PolicyFileNotFound(PolicyError):
    """The policy file (or schema, or backup) does not exist."""


class PolicyInvalid(PolicyError):
    """The candidate policy does not conform to policy.schema.json."""

    def __init__(self, errors: list[dict[str, str]]) -> None:
        self.errors = errors
        detail = "; ".join(f"{e['jsonPath']}: {e['message']}" for e in errors)
        super().__init__(f"policy does not conform to the schema: {detail}")


@dataclass(frozen=True)
class PolicyMeta:
    path: str
    lastModifiedUtc: str | None  # noqa: N815 (mirrors the JSON payload keys)
    sha256: str | None
    sizeBytes: int | None

    def as_dict(self) -> dict[str, str | int | None]:
        return {
            "path": self.path,
            "lastModifiedUtc": self.lastModifiedUtc,
            "sha256": self.sha256,
            "sizeBytes": self.sizeBytes,
        }


class ValidationErrorInfo(BaseModel):
    """One schema violation, formatted for the UI."""

    jsonPath: str
    message: str


def _now_stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


class PolicyFileService:
    """Reads/writes one policy.json file, guarded by a process-local lock."""

    def __init__(self, path: Path, schema_path: Path, max_backups: int) -> None:
        self._path = path
        self._schema_path = schema_path
        self._max_backups = max_backups
        self._backup_dir = path.parent / "policy-backups"
        self._lock = threading.Lock()
        self._validator = Draft7Validator(self._load_json(schema_path))

    # --- reading ---

    def read(self) -> tuple[dict[str, object], PolicyMeta]:
        """Return the current policy document and its file metadata."""
        with self._lock:
            policy = self._read_json(self._path)
            return policy, self._meta()

    def read_schema(self) -> dict[str, object]:
        return self._load_json(self._schema_path)

    def read_seed(self) -> dict[str, object]:
        """The seed policy (policy.json.example next to the schema)."""
        seed_path = self._schema_path.parent / "policy.json.example"
        return self._load_json(seed_path)

    @property
    def seed_path(self) -> Path:
        return self._schema_path.parent / "policy.json.example"

    # --- validation ---

    def validate(self, candidate: dict[str, object]) -> list[ValidationErrorInfo]:
        """Validate a candidate document against the schema without writing."""
        errors = sorted(self._validator.iter_errors(candidate), key=lambda e: list(e.absolute_path))
        return [
            ValidationErrorInfo(jsonPath=_json_path(e.absolute_path), message=e.message)
            for e in errors
        ]

    # --- writing ---

    def write(self, candidate: dict[str, object], expected_sha256: str | None = None) -> PolicyMeta:
        """Validate, back up, and atomically replace the policy file.

        expected_sha256 enables optimistic concurrency: if set and the current
        file hash differs, the write is refused (stale copy).
        """
        if errors := self.validate(candidate):
            raise PolicyInvalid([e.model_dump() for e in errors])
        with self._lock:
            if expected_sha256 is not None:
                current_hash = _hash_file(self._path) if self._path.exists() else None
                if current_hash != expected_sha256:
                    raise PolicyStaleError(expected_sha256, current_hash)
            self._backup_current()
            self._atomic_write(self._path, candidate)
            return self._meta()

    def list_backups(self) -> list[dict[str, str | int | None]]:
        """Return backup ids (newest first) with file metadata."""
        if not self._backup_dir.is_dir():
            return []
        backups = sorted(
            (p for p in self._backup_dir.iterdir() if _BACKUP_ID.fullmatch(_backup_id_of(p))),
            key=lambda p: p.name,
            reverse=True,
        )
        return [
            {
                "id": _backup_id_of(p),
                "lastModifiedUtc": datetime.fromtimestamp(p.stat().st_mtime, tz=UTC).isoformat(),
                "sizeBytes": p.stat().st_size,
            }
            for p in backups
        ]

    def restore(self, backup_id: str) -> PolicyMeta:
        """Restore a backup: validate it, back up the current file, write it."""
        if not _BACKUP_ID.fullmatch(backup_id):
            raise PolicyError(f"invalid backup id: {backup_id}")
        backup_path = self._backup_dir / f"{self._path.name}{_BACKUP_SUFFIX}{backup_id}"
        if not backup_path.is_file():
            raise PolicyFileNotFound(f"backup not found: {backup_id}")
        candidate = self._read_json(backup_path)
        if errors := self.validate(candidate):
            raise PolicyInvalid([e.model_dump() for e in errors])
        with self._lock:
            self._backup_current()
            self._atomic_write(self._path, candidate)
            return self._meta()

    # --- internals ---

    def _meta(self) -> PolicyMeta:
        if not self._path.exists():
            return PolicyMeta(
                path=str(self._path), lastModifiedUtc=None, sha256=None, sizeBytes=None
            )
        stat = self._path.stat()
        return PolicyMeta(
            path=str(self._path),
            lastModifiedUtc=datetime.fromtimestamp(stat.st_mtime, tz=UTC).isoformat(),
            sha256=_hash_file(self._path),
            sizeBytes=stat.st_size,
        )

    def _backup_current(self) -> None:
        if not self._path.exists():
            return
        self._backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = _now_stamp()
        target = self._backup_dir / f"{self._path.name}{_BACKUP_SUFFIX}{stamp}"
        counter = 1
        while target.exists():  # same-second collision: append a counter
            target = self._backup_dir / f"{self._path.name}{_BACKUP_SUFFIX}{stamp}-{counter}"
            counter += 1
        shutil.copy2(self._path, target)
        self._prune_backups()

    def _prune_backups(self) -> None:
        backups = sorted(
            p
            for p in self._backup_dir.iterdir()
            if p.name.startswith(self._path.name + _BACKUP_SUFFIX)
        )
        for old in backups[: -self._max_backups] if self._max_backups > 0 else []:
            old.unlink()

    def _atomic_write(self, target: Path, document: dict[str, object]) -> None:
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(dir=target.parent, prefix=".policy-", suffix=".tmp")
        tmp = Path(tmp_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(document, f, indent=2)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, target)  # atomic on POSIX: readers never see a partial file
        finally:
            tmp.unlink(missing_ok=True)

    def _read_json(self, path: Path) -> dict[str, object]:
        if not path.is_file():
            raise PolicyFileNotFound(f"file not found: {path}")
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            raise PolicyError(f"{path} is not valid JSON: {e}") from e

    def _load_json(self, path: Path) -> dict[str, object]:
        document = self._read_json(path)
        if not isinstance(document, dict):
            raise PolicyError(f"{path} does not contain a JSON object")
        return document


class PolicyStaleError(PolicyError):
    """The file changed since the caller last read it (If-Match mismatch)."""

    def __init__(self, expected: str, current: str | None) -> None:
        self.expected = expected
        self.current = current
        super().__init__(
            "policy changed since you read it "
            f"(expected sha256 {expected}, current {current or '<no file>'})"
        )


def _hash_file(path: Path) -> str | None:
    if not path.exists():
        return None
    return sha256(path.read_bytes()).hexdigest()


def _backup_id_of(path: Path) -> str:
    return path.name.split(_BACKUP_SUFFIX)[-1]


def _json_path(parts: tuple[object, ...]) -> str:
    out = "$"
    for part in parts:
        out += f"[{part}]" if isinstance(part, int) else f".{part}"
    return out


_service: PolicyFileService | None = None


def get_policy_service() -> PolicyFileService:
    """FastAPI dependency returning the process-wide policy service."""
    global _service
    if _service is None:
        from app.pi_policy.state import ensure_state, schema_path

        ensure_state()  # seed the (possibly serverless) state dir before first read
        _service = PolicyFileService(
            path=Path(settings.POLICY_PATH).resolve(),
            schema_path=Path(schema_path()).resolve(),
            max_backups=settings.POLICY_MAX_BACKUPS,
        )
    return _service


def reset_policy_service() -> None:
    """Drop the cached service (used by tests to rebind paths)."""
    global _service
    _service = None
