"""Injection signatures are per user: the gateway runs the agent owner's list."""

from unittest.mock import MagicMock

from app.gateway.keys import hash_key
from app.gateway.router import get_guardrail_engine
from app.guardrails.models import Guardrail, InjectionSignature
from app.guardrails.signatures import GatewaySignatureLoader

AGENT_ID = "11111111-2222-3333-4444-555555555555"
INJECTION = Guardrail.model_validate(
    {
        "id": "gr-injection",
        "name": "Prompt injection",
        "engine": "regex",
        "stages": ["input"],
        "action": "block",
        "config": {"template": "prompt_injection"},
    }
)


class RecordingLoader:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str]] = []

    def load(self, agent_id: str, key: str) -> list[InjectionSignature]:
        self.calls.append((agent_id, key))
        return [InjectionSignature(id="owner-only", regex="(?i)open sesame")]


def test_gateway_loader_asks_the_database_with_the_key_hash() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = [{"id": "sig-a", "regex": "ignore"}]

    signatures = GatewaySignatureLoader(client).load(AGENT_ID, "gk_secret")

    client.rpc.assert_called_once_with(
        "gateway_agent_signatures", {"p_agent_id": AGENT_ID, "p_key_hash": hash_key("gk_secret")}
    )
    assert signatures == [InjectionSignature(id="sig-a", regex="ignore")]


def test_a_wrong_key_gets_no_signatures() -> None:
    client = MagicMock()
    client.rpc.return_value.execute.return_value.data = None
    assert GatewaySignatureLoader(client).load(AGENT_ID, "gk_wrong") == []


def test_the_gateway_engine_matches_the_agent_owners_signatures() -> None:
    loader = RecordingLoader()

    engine = get_guardrail_engine(AGENT_ID, "gk_secret", loader)
    result = engine.check(INJECTION, "please open sesame", "input")

    assert loader.calls == [(AGENT_ID, "gk_secret")]
    assert result.result == "block"
    assert "owner-only" in result.reason


def test_unauthenticated_calls_do_not_read_signatures() -> None:
    loader = RecordingLoader()
    get_guardrail_engine(AGENT_ID, None, loader)
    get_guardrail_engine("not-a-uuid", "gk_secret", loader)
    assert loader.calls == []
