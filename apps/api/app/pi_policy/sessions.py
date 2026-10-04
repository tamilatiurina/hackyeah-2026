"""Inventory of pi session files (~/.pi/agent/sessions/<project-slug>/*.jsonl).

Session JSONL format (pi ~0.85): first line a "session" header (id, cwd,
timestamp), then "message" lines; assistant messages carry usage tokens and
cost. We extract per-session aggregates only — no transcripts — so the page
stays an overview, not a log dump.
"""

import json
import os
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings

MAX_SESSIONS = 200
MAX_FILE_BYTES = 4_000_000  # skip pathological files


@dataclass(frozen=True)
class SessionSummary:
    id: str
    timestamp: str
    cwd: str
    projectDir: str  # noqa: N815 (payload keys)
    model: str
    messages: int
    toolCalls: int  # noqa: N815
    totalTokens: int  # noqa: N815
    cacheTokens: int  # noqa: N815
    costUsd: float | None  # noqa: N815
    durationMs: int | None  # noqa: N815
    title: str
    fromPlayground: bool  # noqa: N815

    def as_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "timestamp": self.timestamp,
            "cwd": self.cwd,
            "projectDir": self.projectDir,
            "model": self.model,
            "messages": self.messages,
            "toolCalls": self.toolCalls,
            "totalTokens": self.totalTokens,
            "cacheTokens": self.cacheTokens,
            "costUsd": self.costUsd,
            "durationMs": self.durationMs,
            "title": self.title,
            "fromPlayground": self.fromPlayground,
        }


@dataclass(frozen=True)
class SessionsOverview:
    sessions: list[SessionSummary]
    stats: dict[str, object]

    def as_dict(self) -> dict[str, object]:
        return {
            "sessions": [s.as_dict() for s in self.sessions],
            "stats": self.stats,
        }


def sessions_root() -> Path:
    """Explicit PI_SESSIONS_DIR wins; on serverless fall back to the state dir."""
    if settings.PI_SESSIONS_DIR:
        return Path(settings.PI_SESSIONS_DIR)
    if Path("/tmp/.vercel").exists() or os.environ.get("VERCEL"):
        return Path(settings.POLICY_PATH).parent / "agent" / "sessions"
    return Path.home() / ".pi" / "agent" / "sessions"


def read_sessions() -> SessionsOverview:
    """All parseable sessions, newest first, capped at MAX_SESSIONS."""
    root = sessions_root()
    if not root.is_dir():
        return SessionsOverview([], _stats([], {}))

    repo_root = str(settings.REPO_ROOT)
    found: list[SessionSummary] = []
    # pi nests one dir per project cwd (<root>/<project-slug>/*.jsonl), but a
    # custom PI_CODING_AGENT_SESSION_DIR may store files flat in the root.
    project_dirs = [d for d in sorted(root.iterdir()) if d.is_dir()]
    jsonls: list[tuple[Path, str]] = [(j, d.name) for d in project_dirs for j in d.glob("*.jsonl")]
    jsonls += [(j, "--flat--") for j in root.glob("*.jsonl")]
    for jsonl, project_dir in jsonls:
        try:
            if jsonl.stat().st_size > MAX_FILE_BYTES:
                continue
            parsed = _parse_session(jsonl, project_dir, repo_root)
        except (OSError, ValueError):
            continue
        if parsed is not None:
            found.append(parsed)

    found.sort(key=lambda s: s.timestamp, reverse=True)
    capped = found[:MAX_SESSIONS]
    projects: dict[str, int] = {}
    for s in capped:
        projects[s.projectDir] = projects.get(s.projectDir, 0) + 1
    return SessionsOverview(capped, _stats(capped, projects))


def _stats(sessions: list[SessionSummary], projects: dict[str, int]) -> dict[str, object]:
    n = len(sessions)
    costs = [s.costUsd for s in sessions if s.costUsd is not None]
    tokens = sum(s.totalTokens for s in sessions)
    cache_tokens = sum(s.cacheTokens for s in sessions)
    tool_calls = sum(s.toolCalls for s in sessions)
    durations = [s.durationMs for s in sessions if s.durationMs is not None]
    return {
        "sessionCount": n,
        "totalCostUsd": round(sum(costs), 4) if costs else 0.0,
        "totalTokens": tokens,
        "totalCacheTokens": cache_tokens,
        "totalToolCalls": tool_calls,
        "avgCostUsd": round(sum(costs) / len(costs), 6) if costs else 0.0,
        "avgTokens": round(tokens / n) if n else 0,
        "avgDurationMs": round(sum(durations) / len(durations)) if durations else 0,
        "projects": dict(sorted(projects.items(), key=lambda kv: -kv[1])),
    }


def _parse_session(jsonl: Path, project_dir: str, repo_root: str) -> SessionSummary | None:
    session_id = jsonl.stem.split("_", 1)[-1]
    first_ts: str | None = None
    cwd = ""
    model = ""
    messages = 0
    tool_calls = 0
    tokens = 0
    cache_tokens = 0
    cost = 0.0
    saw_cost = False
    last_ts: str | None = None
    title = ""

    with jsonl.open("r", encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(entry, dict):
                continue

            if entry.get("type") == "session":
                session_id = str(entry.get("id") or session_id)
                first_ts = entry.get("timestamp") or first_ts
                cwd = str(entry.get("cwd") or "")

            if entry.get("type") != "message":
                continue
            message = entry.get("message") or {}
            role = message.get("role")
            ts = entry.get("timestamp") or message.get("timestamp")
            if ts:
                last_ts = str(ts)

            content = message.get("content")
            if role == "user" and not title:
                title = _first_text(content)[:90]
            if role == "assistant":
                if isinstance(content, list):
                    tool_calls += sum(
                        1 for c in content if isinstance(c, dict) and c.get("type") == "toolCall"
                    )
                usage = message.get("usage") or {}
                tokens += int(usage.get("totalTokens") or 0)
                cache_tokens += int(usage.get("cacheRead") or 0) + int(usage.get("cacheWrite") or 0)
                msg_cost = (usage.get("cost") or {}).get("total")
                if isinstance(msg_cost, (int, float)):
                    cost += float(msg_cost)
                    saw_cost = True
                if not model and message.get("model"):
                    model = str(message["model"])
            if role in ("user", "assistant", "toolResult"):
                messages += 1

    if messages == 0:
        return None  # empty/partial session
    duration_ms = None
    if first_ts and last_ts:
        duration_ms = max(0, int((_parse_ts(last_ts) - _parse_ts(first_ts)) * 1000))
    return SessionSummary(
        id=session_id,
        timestamp=first_ts or datetime.now(UTC).isoformat(),
        cwd=cwd,
        projectDir=project_dir,
        model=model,
        messages=messages,
        toolCalls=tool_calls,
        totalTokens=tokens,
        cacheTokens=cache_tokens,
        costUsd=round(cost, 6) if saw_cost else None,
        durationMs=duration_ms,
        title=title or "(no prompt)",
        fromPlayground=cwd.startswith(repo_root),
    )


def _first_text(content: object) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                return str(part.get("text", ""))
    return ""


def _parse_ts(ts: str) -> float:
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0
