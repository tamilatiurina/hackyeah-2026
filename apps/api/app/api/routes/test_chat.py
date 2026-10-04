"""B-06: the panel's test chat, POST /api/v1/agents/{agent_id}/test-chat.

The signed-in owner sends an A2A SendMessage call. It goes through the same guarded path as
the agent's guarded URL (app.gateway.service): input guardrails, the agent, output guardrails.
The answer is the A2A reply with metadata.guardrailHub holding the full trace, the token usage,
the limits used and the evaluator scores. The turn is counted in the session (A-07) and every
block, redaction and warning goes to the audit log, recorded as the signed-in owner.

One contextId per chat: the panel sends it; if it is missing, one is created and returned.
"""

from typing import Annotated, Any, Literal
from uuid import UUID, uuid4

import httpx
from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, ConfigDict, Field

from app.api.deps import get_role
from app.api.routes.agents.deps import AgentDatabase, get_agent_database
from app.api.routes.agents.target import load_upstream_target
from app.audit.recorder import AuditRecorder, InMemoryAuditRecorder, OwnerAuditRecorder
from app.bindings.repository import BindingRepository, get_binding_repository
from app.bindings.resolve import resolve_for_request
from app.core.config import settings
from app.gateway import a2a, limits
from app.gateway.pipeline import GuardrailEngine
from app.gateway.service import (
    Audit,
    GuardedReply,
    get_gateway_http_client,
    get_guardrail_engine,
    send_guarded,
)
from app.guardrails.repository import GuardrailRepository, get_guardrail_repository

router = APIRouter(prefix="/agents", tags=["test chat"])


def get_test_chat_recorder(
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
) -> AuditRecorder:
    """Audit as the signed-in owner (their own Supabase client); in memory without Supabase."""
    if settings.SUPABASE_URL and settings.SUPABASE_KEY:
        return OwnerAuditRecorder(database.client)
    return InMemoryAuditRecorder()


# --- the A2A 1.0 subset the panel sends and reads (docs/agent-contract-a2a.md) -------------
# Field names are A2A's camelCase. Unknown fields are kept, so nothing the agent sends is lost.


class _A2AModel(BaseModel):
    model_config = ConfigDict(extra="allow")


class Part(_A2AModel):
    text: str | None = None


class A2AMessage(_A2AModel):
    messageId: str = Field(min_length=1)
    contextId: str | None = None
    role: Literal["ROLE_USER", "ROLE_AGENT"]
    parts: list[Part] = Field(min_length=1)
    metadata: dict[str, Any] | None = None


class SendMessageParams(_A2AModel):
    message: A2AMessage


class ChatRequest(BaseModel):
    """An A2A SendMessage call (JSON-RPC 2.0)."""

    jsonrpc: Literal["2.0"]
    id: str | int
    method: Literal["SendMessage"]
    params: SendMessageParams


class TraceEntry(BaseModel):
    guardrailId: str
    guardrailName: str
    engine: Literal["regex", "llm_judge", "library", "moderation"]
    source: Literal["mandatory", "agent", "role", "user"]
    stage: Literal["input", "output"]
    verdict: Literal["pass", "block", "redact", "warn"]
    reason: str
    latencyMs: float
    simulated: bool = False


class Usage(BaseModel):
    inputTokens: int
    outputTokens: int
    costUsd: float = Field(description="The tokens priced from the hub's price table (B-05)")
    model: str = Field(description="The price-table entry used")
    estimated: bool = Field(description="True when the agent sent no usage and it was estimated")


class LimitUsed(BaseModel):
    name: str
    used: float
    max: float
    unit: str | None = None


class EvaluatorScore(BaseModel):
    name: str
    score: float


class GuardrailHubMetadata(BaseModel):
    policyVersion: str | None = Field(
        default=None, description="Hash of the resolved guardrail set; changes on config edits"
    )
    role: str | None = None
    blocked: bool = False
    stage: Literal["input", "output"] | None = None
    trace: list[TraceEntry]
    usage: Usage
    limits: list[LimitUsed] = Field(
        description="Per-call and per-session limits this call used (B-05, FR-25/26)"
    )
    scores: list[EvaluatorScore] = Field(description="Evaluator scores (FR-28); none yet")


class ReplyMetadata(_A2AModel):
    guardrailHub: GuardrailHubMetadata | None = None


class ReplyMessage(A2AMessage):
    parts: list[Part]  # an agent may answer with no parts; don't reject its reply
    metadata: ReplyMetadata | None = None  # type: ignore[assignment]


class Artifact(_A2AModel):
    artifactId: str | None = None
    parts: list[Part]


class TaskStatus(_A2AModel):
    state: str
    message: ReplyMessage | None = None


class A2ATask(_A2AModel):
    id: str
    contextId: str | None = None
    status: TaskStatus
    artifacts: list[Artifact] | None = None
    metadata: ReplyMetadata | None = None


class MessageResult(BaseModel):
    message: ReplyMessage


class TaskResult(BaseModel):
    task: A2ATask


class RpcError(BaseModel):
    code: int
    message: str
    data: dict[str, Any] | None = None


class ChatResponse(BaseModel):
    """The A2A SendMessage response: a result (message or task) or a JSON-RPC error."""

    jsonrpc: Literal["2.0"] = "2.0"
    id: str | int | None
    result: MessageResult | TaskResult | None = None
    error: RpcError | None = None


# --- the route --------------------------------------------------------------------------------


def _usage(request_message: a2a.Json, reply: GuardedReply) -> Usage:
    """The call's token and cost figures (B-05). When the agent never answered (blocked on the
    way in, cut at the time limit, an error) only the message is counted."""
    usage = reply.usage
    if usage is None:
        sent, _ = a2a.checked_text([request_message])
        tokens = limits.estimate_tokens(sent)
        usage = limits.CallUsage(tokens, 0, limits.price("default", tokens, 0), "default", True)
    return Usage.model_validate(usage.as_hub())


@router.post("/{agent_id}/test-chat", response_model=ChatResponse, response_model_exclude_none=True)
async def send_test_chat_message(
    agent_id: UUID,
    body: ChatRequest,
    database: Annotated[AgentDatabase, Depends(get_agent_database)],
    guardrails: Annotated[GuardrailRepository, Depends(get_guardrail_repository)],
    bindings: Annotated[BindingRepository, Depends(get_binding_repository)],
    role: Annotated[str | None, Depends(get_role)],
    engine: Annotated[GuardrailEngine, Depends(get_guardrail_engine)],
    client: Annotated[httpx.AsyncClient, Depends(get_gateway_http_client)],
    recorder: Annotated[AuditRecorder, Depends(get_test_chat_recorder)],
) -> ChatResponse:
    target = await run_in_threadpool(load_upstream_target, database, agent_id)

    call: a2a.Json = body.model_dump(mode="json", exclude_none=True)
    message: a2a.Json = call["params"]["message"]
    message.setdefault("contextId", f"ctx-{uuid4()}")  # one contextId per chat

    # The test chat knows who is asking: the panel's role (X-Role) and the signed-in user, so
    # role and user bindings apply, resolved exactly like GET /effective-guardrails.
    policy = await run_in_threadpool(
        resolve_for_request, guardrails, bindings, str(agent_id), role, database.owner_id
    )

    reply = await send_guarded(
        call,
        target=target,
        policy=policy,
        engine=engine,
        client=client,
        audit=Audit(recorder=recorder, agent_id=str(agent_id)),
        role=role,
    )

    answer = reply.body
    result = answer.get("result")
    if isinstance(result, dict):
        found = result.get("message")
        holder: a2a.Json = found if isinstance(found, dict) else result["task"]
        hub: a2a.Json = (holder.get("metadata") or {}).get(a2a.METADATA_KEY) or {}
        hub.setdefault("trace", [])
        hub["usage"] = _usage(message, reply).model_dump()
        hub["limits"] = reply.limits
        hub["scores"] = []  # FR-28 evaluators are not wired in yet
        a2a.add_hub_metadata(result, hub)
    return ChatResponse.model_validate(answer)
