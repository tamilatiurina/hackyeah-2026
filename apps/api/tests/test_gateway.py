"""B-01 gateway: guarded Agent Card, key check, SendMessage forwarding, errors.

The upstream in most tests is the real apps/test-agent, reached in-process. The guarded URL is
then called both with plain JSON-RPC and with the official a2a-sdk client.
"""

import json
import sys
from collections.abc import AsyncIterator, Callable, Iterator
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock

import httpx
import pytest
from a2a.client import (
    AuthInterceptor,
    ClientCallContext,
    ClientConfig,
    InMemoryContextCredentialStore,
    create_client,
)
from a2a.types import a2a_pb2 as a2a_types
from app.api.routes.agents.deps import AgentDatabase, ResolvedUpstream, get_agent_database
from app.audit.memory import MEMORY
from app.audit.recorder import InMemoryAuditRecorder, get_audit_recorder
from app.bindings.models import EffectivePolicy
from app.bindings.resolve import resolve
from app.gateway import a2a
from app.gateway import router as gateway_router
from app.gateway import service as gateway_service
from app.gateway.keys import KEY_PREFIX, hash_key
from app.gateway.policy import get_policy_loader
from app.gateway.resolver import SupabaseAgentResolver, UpstreamTarget, get_agent_resolver
from app.main import app
from fastapi.testclient import TestClient
from pydantic import HttpUrl

# apps/test-agent is a separate project (root uv workspace); it needs only FastAPI, so the
# API's tests load it straight from its source folder.
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "test-agent" / "src"))
from acme_test_agent.app import agent_card as card_of_test_agent  # noqa: E402
from acme_test_agent.app import create_app as create_test_agent  # noqa: E402

client = TestClient(app)

AGENT_ID = "7b4eb987-4315-4745-83c7-258061f2f2c4"
GOOD_KEY = "gk_test_key"
BASE_URL = "https://agent.example.com"
SEND = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "SendMessage",
    "params": {
        "message": {
            "messageId": "m-1",
            "role": "ROLE_USER",
            "parts": [{"text": "Where is my order #48213?"}],
        }
    },
}

UPSTREAM_AUTH = "Bearer upstream-secret"


def make_test_agent() -> Any:
    """apps/test-agent, requiring the agent's own key like a real deployment would."""
    return create_test_agent(auth_value=UPSTREAM_AUTH, public_url=BASE_URL)


# --- wiring ---------------------------------------------------------------------------------


class FakeResolver:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def resolve(self, agent_id: str, key: str) -> UpstreamTarget | None:
        self.calls.append((agent_id, key))
        if agent_id != AGENT_ID or key != GOOD_KEY:
            return None
        return UpstreamTarget(
            upstream_url=f"{BASE_URL}/a2a",  # the card's JSON-RPC endpoint, saved at registration
            auth_header_name="Authorization",
            auth_header_value=UPSTREAM_AUTH,
        )

    def agent_card(self, agent_id: str) -> dict[str, Any] | None:
        # The snapshot registration stores: the test agent's own card.
        return card_of_test_agent(BASE_URL, "Authorization") if agent_id == AGENT_ID else None


class NoGuardrails:
    """B-01's behaviour: no guardrails attached (B-02's tests attach some)."""

    def load(self, agent_id: str, key: str, role: str | None = None) -> EffectivePolicy:
        return resolve([], [], agent_id=agent_id, role=role)


class Recorder(httpx.AsyncBaseTransport):
    """Passes calls to the upstream and remembers what went in and came out."""

    def __init__(self, inner: httpx.AsyncBaseTransport) -> None:
        self.inner = inner
        self.requests: list[httpx.Request] = []
        self.bodies: list[bytes] = []

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        response = await self.inner.handle_async_request(request)
        body = await response.aread()
        self.bodies.append(body)
        return httpx.Response(response.status_code, headers=response.headers, content=body)


def use_upstream(transport: httpx.AsyncBaseTransport) -> None:
    async def override() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=transport) as http_client:
            yield http_client

    app.dependency_overrides[gateway_router.get_gateway_http_client] = override


def scripted_upstream(rpc: Callable[[httpx.Request], httpx.Response]) -> None:
    use_upstream(httpx.MockTransport(rpc))


@pytest.fixture(autouse=True)
def setup(monkeypatch: pytest.MonkeyPatch) -> Iterator[FakeResolver]:
    async def allow_test_upstream(url: HttpUrl) -> ResolvedUpstream:
        original = httpx.URL(str(url))
        return ResolvedUpstream(
            url=original,
            host_header=original.netloc.decode("ascii"),
            sni_hostname=original.host,
        )

    monkeypatch.setattr(gateway_service, "ensure_public_upstream", allow_test_upstream)
    resolver = FakeResolver()
    app.dependency_overrides[get_agent_resolver] = lambda: resolver
    app.dependency_overrides[get_policy_loader] = NoGuardrails
    yield resolver
    app.dependency_overrides.clear()


def post(body: Any = SEND, key: str | None = GOOD_KEY, agent_id: str = AGENT_ID) -> httpx.Response:
    headers = {"X-API-Key": key} if key else {}
    return client.post(f"/a/{agent_id}", json=body, headers=headers)


# --- the guarded Agent Card -----------------------------------------------------------------


def card_of_test_agent_is_rewritten_for_the_gateway() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))

    r = client.get(f"/a/{AGENT_ID}/.well-known/agent-card.json")

    assert r.status_code == 200
    card = r.json()
    assert card["name"] == "test-agent"
    assert {skill["id"] for skill in card["skills"]} >= {"pii", "echo"}
    assert card["supportedInterfaces"] == [
        {
            "url": f"http://testserver/a/{AGENT_ID}",
            "protocolBinding": "JSONRPC",
            "protocolVersion": "1.0",
        }
    ]
    assert card["capabilities"]["streaming"] is False
    assert card["capabilities"]["pushNotifications"] is False
    assert card["securitySchemes"] == {
        "hubKey": {"apiKeySecurityScheme": {"location": "header", "name": "X-API-Key"}}
    }
    assert card["securityRequirements"] == [{"schemes": {"hubKey": {"list": []}}}]
    assert "agent.example.com" not in r.text  # the upstream address never leaks


def card_of_test_agent_of_an_unknown_agent_is_404() -> None:
    assert client.get("/a/not-a-uuid/.well-known/agent-card.json").status_code == 404
    other = "00000000-0000-0000-0000-000000000000"
    assert client.get(f"/a/{other}/.well-known/agent-card.json").status_code == 404


# --- AC: the test agent answers unchanged ---------------------------------------------------


def test_agent_answers_unchanged_through_the_gateway() -> None:
    upstream = Recorder(httpx.ASGITransport(app=make_test_agent()))
    use_upstream(upstream)

    r = post()

    assert r.status_code == 200
    assert r.json()["result"]["message"]["parts"] == [{"text": "Echo: Where is my order #48213?"}]
    [rpc_request] = upstream.requests  # one call: no card fetch on the hot path
    assert rpc_request.url == f"{BASE_URL}/a2a"  # the endpoint stored at registration
    assert rpc_request.headers["a2a-version"] == "1.0"
    assert rpc_request.headers["authorization"] == "Bearer upstream-secret"  # the agent's key
    assert "x-api-key" not in rpc_request.headers  # never the caller's gateway key
    assert json.loads(rpc_request.content) == SEND  # the call, unchanged
    assert r.content == upstream.bodies[-1]  # the answer, byte for byte


# --- AC: the official a2a-sdk client, using only the guarded Agent Card ---------------------


@pytest.mark.anyio
async def test_official_a2a_sdk_client_talks_to_the_guarded_url() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))
    credentials = InMemoryContextCredentialStore()
    await credentials.set_credentials("session-1", "hubKey", GOOD_KEY)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://testserver"
    ) as http_client:
        sdk_client = await create_client(
            f"http://testserver/a/{AGENT_ID}",
            client_config=ClientConfig(httpx_client=http_client, streaming=False),
            interceptors=[AuthInterceptor(credentials)],
        )
        request = a2a_types.SendMessageRequest(
            message=a2a_types.Message(
                message_id="m-1",
                role=a2a_types.Role.ROLE_USER,
                parts=[a2a_types.Part(text="hello")],
            )
        )
        context = ClientCallContext(state={"sessionId": "session-1"})
        replies = [reply async for reply in sdk_client.send_message(request, context=context)]

    assert [part.text for part in replies[0].message.parts] == ["Echo: hello"]


# --- AC: a wrong or missing key returns 401 ---------------------------------------------------


def test_missing_key_is_401() -> None:
    r = post(key=None)
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid or missing gateway key"}


def test_wrong_key_is_401(setup: FakeResolver) -> None:
    assert post(key="gk_wrong").status_code == 401
    assert setup.calls == [(AGENT_ID, "gk_wrong")]


def test_unknown_agent_is_401_like_a_wrong_key() -> None:
    assert post(agent_id="00000000-0000-0000-0000-000000000000").status_code == 401
    assert post(agent_id="not-a-uuid").status_code == 401


def test_key_only_counts_in_x_api_key() -> None:
    r = client.post(f"/a/{AGENT_ID}", json=SEND, headers={"Authorization": f"Bearer {GOOD_KEY}"})
    assert r.status_code == 401


# --- AC: upstream errors pass through; an unreachable upstream is -32603 ------------------


def send(text: str) -> dict[str, Any]:
    body = json.loads(json.dumps(SEND))
    body["params"]["message"]["parts"] = [{"text": text}]
    return body


def test_upstream_jsonrpc_errors_pass_through() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))
    assert post(send("#error")).json() == {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {"code": -32603, "message": "Simulated agent failure (#error)"},
    }


def test_unreachable_upstream_is_32603() -> None:
    def down(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    use_upstream(httpx.MockTransport(down))
    r = post()
    assert r.status_code == 200
    assert r.json() == {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {
            "code": -32603,
            "message": "Upstream agent could not be reached",
            "data": {"reason": "unreachable"},
        },
    }


def test_slow_upstream_is_32603_with_reason_timeout() -> None:
    def slow(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("too slow", request=request)

    scripted_upstream(slow)
    assert post().json()["error"] == {
        "code": -32603,
        "message": "Upstream agent did not answer in time",
        "data": {"reason": "timeout"},
    }


def test_crashing_upstream_is_32603() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))
    error = post(send("#crash")).json()["error"]
    assert error["code"] == -32603
    assert error["data"] == {"reason": "invalid_response"}


def test_unfinished_task_is_an_invalid_response() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))
    error = post(send("#working")).json()["error"]
    assert error["code"] == -32603
    assert error["data"] == {"reason": "invalid_response"}


def test_finished_task_passes_through() -> None:
    use_upstream(httpx.ASGITransport(app=make_test_agent()))
    task = post(send("#task hello")).json()["result"]["task"]
    assert task["status"]["state"] == "TASK_STATE_COMPLETED"


# --- only SendMessage -------------------------------------------------------------------------


def test_other_a2a_methods_are_unsupported() -> None:
    scripted_upstream(lambda _r: pytest.fail("must not reach the agent"))
    r = post({"jsonrpc": "2.0", "id": 7, "method": "GetTask", "params": {"id": "t-1"}})
    assert r.json() == {
        "jsonrpc": "2.0",
        "id": 7,
        "error": {"code": -32004, "message": "Only SendMessage is supported"},
    }


def test_not_jsonrpc_is_an_invalid_request() -> None:
    r = post({"messages": [{"role": "user", "content": "hi"}]})
    assert r.json()["error"]["code"] == -32600


# --- storage: only the hash ever leaves the API -----------------------------------------------


def test_supabase_resolver_sends_only_the_key_hash() -> None:
    database = MagicMock()
    database.rpc.return_value.execute.return_value.data = [
        {
            "upstream_url": BASE_URL,
            "auth_header_name": None,
            "auth_header_value": None,
        }
    ]

    target = SupabaseAgentResolver(database).resolve(AGENT_ID, GOOD_KEY)

    assert target == UpstreamTarget(upstream_url=BASE_URL)
    database.rpc.assert_called_once_with(
        "gateway_resolve_agent", {"p_agent_id": AGENT_ID, "p_key_hash": hash_key(GOOD_KEY)}
    )

    database.rpc.return_value.execute.return_value.data = []
    assert SupabaseAgentResolver(database).resolve(AGENT_ID, "gk_wrong") is None


def test_supabase_resolver_reads_the_stored_card() -> None:
    card = card_of_test_agent(BASE_URL, None)
    database = MagicMock()
    database.rpc.return_value.execute.return_value.data = card
    assert SupabaseAgentResolver(database).agent_card(AGENT_ID) == card
    database.rpc.assert_called_once_with("gateway_agent_card", {"p_agent_id": AGENT_ID})

    database.rpc.return_value.execute.return_value.data = None
    assert SupabaseAgentResolver(database).agent_card(AGENT_ID) is None


def test_owner_creates_a_gateway_key_and_only_its_hash_is_stored() -> None:
    database = MagicMock()
    query = database.table.return_value.update.return_value.eq.return_value
    query.execute.return_value.data = [{"id": AGENT_ID}]
    app.dependency_overrides[get_agent_database] = lambda: AgentDatabase(
        client=database, owner_id="971f4031-2dd9-4327-94c7-45323de61c67"
    )

    r = client.post(f"/api/v1/agents/{AGENT_ID}/gateway-key")

    assert r.status_code == 201
    body = r.json()
    assert body["key"].startswith(KEY_PREFIX)
    assert body["gateway_path"] == f"/a/{AGENT_ID}"
    assert body["agent_card_path"] == f"/a/{AGENT_ID}/.well-known/agent-card.json"
    stored = database.table.return_value.update.call_args.args[0]
    assert stored == {"gateway_key_hash": hash_key(body["key"])}
    database.table.return_value.update.return_value.eq.assert_called_once_with("id", AGENT_ID)


def test_gateway_key_for_someone_elses_agent_is_404() -> None:
    database = MagicMock()
    database.table.return_value.update.return_value.eq.return_value.execute.return_value.data = []
    app.dependency_overrides[get_agent_database] = lambda: AgentDatabase(
        client=database, owner_id="971f4031-2dd9-4327-94c7-45323de61c67"
    )
    assert client.post(f"/api/v1/agents/{AGENT_ID}/gateway-key").status_code == 404


# --- A-07: session counters ---------------------------------------------------------------


@pytest.fixture(autouse=True)
def memory_recorder() -> None:
    app.dependency_overrides[get_audit_recorder] = InMemoryAuditRecorder


def with_context(context_id: str | None) -> dict[str, Any]:
    body = json.loads(json.dumps(SEND))
    if context_id is not None:
        body["params"]["message"]["contextId"] = context_id
    return body


def reply_with_usage(usage: object) -> Callable[[httpx.Request], httpx.Response]:
    def rpc(request: httpx.Request) -> httpx.Response:
        message = {
            "messageId": "r-1",
            "role": "ROLE_AGENT",
            "parts": [{"text": "ok"}],
            "metadata": {"usage": usage},
        }
        # json.dumps writes Infinity/NaN as the stdlib json reader accepts them (an agent might too)
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "result": {"message": message}})
        return httpx.Response(200, content=body, headers={"Content-Type": "application/json"})

    return rpc


def test_a_forwarded_call_counts_a_turn_with_the_reply_usage() -> None:
    scripted_upstream(reply_with_usage({"inputTokens": 12, "outputTokens": 7}))
    assert post(with_context("ctx-1")).status_code == 200
    assert post(with_context("ctx-1")).status_code == 200
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.turns, session.input_tokens, session.output_tokens) == (2, 24, 14)


@pytest.mark.parametrize(
    "usage",
    [
        None,
        "lots",
        {"inputTokens": "x"},
        {"inputTokens": -5},
        {"inputTokens": float("inf")},
        {"inputTokens": float("nan")},
        {"inputTokens": True},
    ],
)
def test_missing_or_bad_usage_counts_zero_tokens(usage: object) -> None:
    scripted_upstream(reply_with_usage(usage))
    assert post(with_context("ctx-1")).status_code == 200
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.turns, session.input_tokens, session.output_tokens) == (1, 0, 0)


def test_no_context_id_or_an_agent_error_records_nothing() -> None:
    scripted_upstream(reply_with_usage({"inputTokens": 1, "outputTokens": 1}))
    post(with_context(None))
    scripted_upstream(
        lambda r: httpx.Response(
            200, json={"jsonrpc": "2.0", "id": 1, "error": {"code": -32603, "message": "boom"}}
        )
    )
    post(with_context("ctx-err"))
    assert MEMORY.sessions == {}


def test_a_recorder_failure_does_not_change_the_reply() -> None:
    class Broken:
        def record_turn(self, *args: object) -> None:
            raise RuntimeError("storage down")

        def record_events(self, *args: object) -> int:
            raise RuntimeError("storage down")

    app.dependency_overrides[get_audit_recorder] = Broken
    scripted_upstream(reply_with_usage({"inputTokens": 1, "outputTokens": 1}))
    r = post(with_context("ctx-1"))
    assert r.status_code == 200
    assert r.json()["result"]["message"]["parts"] == [{"text": "ok"}]


def test_huge_usage_is_capped_so_the_counter_fits_the_database() -> None:
    scripted_upstream(reply_with_usage({"inputTokens": 1e20, "outputTokens": 3}))
    assert post(with_context("ctx-1")).status_code == 200
    session = MEMORY.sessions[(AGENT_ID, "ctx-1")]
    assert (session.input_tokens, session.output_tokens) == (a2a.MAX_REPORTED_TOKENS, 3)
