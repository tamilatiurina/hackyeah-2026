"""The A2A 1.0 pieces the gateway reads and writes (docs/agent-contract-a2a.md).

A2A 1.0 uses protobuf JSON: camelCase keys and enum values like "TASK_STATE_COMPLETED".
"""

import json
from typing import Any
from uuid import uuid4

JSONRPC_VERSION = "2.0"
SEND_MESSAGE = "SendMessage"
A2A_VERSION_HEADER = "A2A-Version"
A2A_VERSION = "1.0"
AGENT_CARD_PATH = "/.well-known/agent-card.json"
JSONRPC_BINDING = "JSONRPC"

# The header callers put their per-deployment key in; the only security scheme on our card.
API_KEY_HEADER = "X-API-Key"
API_KEY_SCHEME = "hubKey"  # name fixed by docs/agent-contract-a2a.md section 5

PARSE_ERROR = -32700
INVALID_REQUEST = -32600
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603
UNSUPPORTED_OPERATION = -32004

# A finished task. Anything else (submitted, working, input required, ...) would need the
# caller to poll or stream, which the gateway doesn't offer, so it's an invalid response.
TERMINAL_TASK_STATES = frozenset(
    {
        "TASK_STATE_COMPLETED",
        "TASK_STATE_FAILED",
        "TASK_STATE_CANCELED",
        "TASK_STATE_REJECTED",
    }
)

Json = dict[str, Any]


def rpc_error(rpc_id: Any, code: int, message: str, reason: str | None = None) -> Json:
    error: Json = {"code": code, "message": message}
    if reason is not None:
        error["data"] = {"reason": reason}  # e.g. "timeout", as the contract asks
    return {"jsonrpc": JSONRPC_VERSION, "id": rpc_id, "error": error}


# Signatures are dropped too: they sign the upstream's card, not ours.
_REPLACED = {"supportedInterfaces", "securitySchemes", "securityRequirements", "signatures"}


def guarded_card(upstream_card: Json, gateway_url: str) -> Json:
    """The upstream Agent Card, rewritten so every call goes through the gateway.

    Name, description, skills and the like are kept. The interfaces, capabilities and
    security are replaced: one JSON-RPC interface at the guarded URL, no streaming or push
    notifications, and the deployment's key in X-API-Key as the only way in.
    """
    card = {key: value for key, value in upstream_card.items() if key not in _REPLACED}
    capabilities = upstream_card.get("capabilities")
    card["capabilities"] = {
        **(capabilities if isinstance(capabilities, dict) else {}),
        "streaming": False,
        "pushNotifications": False,
        # The extended card would come from the upstream unguarded; we don't serve it.
        "extendedAgentCard": False,
    }
    card["supportedInterfaces"] = [
        {"url": gateway_url, "protocolBinding": JSONRPC_BINDING, "protocolVersion": A2A_VERSION}
    ]
    card["securitySchemes"] = {
        API_KEY_SCHEME: {
            "apiKeySecurityScheme": {
                "location": "header",
                "name": API_KEY_HEADER,
            }
        }
    }
    card["securityRequirements"] = [{"schemes": {API_KEY_SCHEME: {"list": []}}}]
    return card


def is_valid_send_message_result(result: Any) -> bool:
    """A SendMessage result is a message, or a task that has finished."""
    if not isinstance(result, dict):
        return False
    if isinstance(result.get("message"), dict):
        return True
    task = result.get("task")
    if not isinstance(task, dict):
        return False
    status = task.get("status")
    return isinstance(status, dict) and status.get("state") in TERMINAL_TASK_STATES


# --- B-02: the text guardrails see, and the hub's data in replies ----------------------------

# Hub data in a message, task or part lives in its metadata under this key (contract §4).
METADATA_KEY = "guardrailHub"


def text_parts(holders: list[Json]) -> list[Json]:
    """The text parts of messages or artifacts, in order. Guardrails check and redact these."""
    found: list[Json] = []
    for holder in holders:
        for part in holder.get("parts") or []:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                found.append(part)
    return found


def checked_text(holders: list[Json]) -> tuple[str, int]:
    """What a guardrail sees (contract §4): text parts and data parts as JSON, joined with
    newlines. Also returns how many file parts (raw / url) went through unchecked."""
    pieces: list[str] = []
    unchecked = 0
    for holder in holders:
        for part in holder.get("parts") or []:
            if not isinstance(part, dict):
                continue
            if isinstance(part.get("text"), str):
                pieces.append(part["text"])
            elif "data" in part:
                pieces.append(json.dumps(part["data"], ensure_ascii=False, sort_keys=True))
            elif "raw" in part or "url" in part:
                unchecked += 1
    return "\n".join(pieces), unchecked


def reply_holders(result: Json) -> list[Json]:
    """What carries the reply text: the message, or the task's artifacts then its status
    message (contract §3)."""
    message = result.get("message")
    if isinstance(message, dict):
        return [message]
    task = result.get("task")
    if not isinstance(task, dict):
        return []
    holders = [a for a in task.get("artifacts") or [] if isinstance(a, dict)]
    status = task.get("status")
    if isinstance(status, dict) and isinstance(status.get("message"), dict):
        holders.append(status["message"])
    return holders


def add_hub_metadata(result: Json, hub: Json) -> None:
    """Put the hub's data in the reply's metadata, next to whatever the agent put there."""
    message = result.get("message")
    target: Json = message if isinstance(message, dict) else result["task"]
    metadata = target.get("metadata")
    if not isinstance(metadata, dict):
        metadata = target["metadata"] = {}
    metadata[METADATA_KEY] = hub


def rejected_task(context_id: Any, reason: str, hub: Json) -> Json:
    """A blocked call: a task in TASK_STATE_REJECTED the caller can read as a refusal (§5)."""
    return {
        "task": {
            "id": f"blk-{uuid4()}",
            "contextId": context_id if isinstance(context_id, str) else str(uuid4()),
            "status": {
                "state": "TASK_STATE_REJECTED",
                "message": {
                    "messageId": str(uuid4()),
                    "role": "ROLE_AGENT",
                    "parts": [{"text": reason}],
                },
            },
            "metadata": {METADATA_KEY: hub},
        }
    }
