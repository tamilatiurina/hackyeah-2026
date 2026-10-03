from typing import Any

import pytest
from acme_test_agent.app import SCENARIOS, create_app
from fastapi.testclient import TestClient

A2A_HEADERS = {"A2A-Version": "1.0"}


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def send(
    client: TestClient,
    *parts: dict[str, Any],
    headers: dict[str, str] | None = None,
    method: str = "SendMessage",
    context_id: str | None = "ctx-1",
) -> dict[str, Any]:
    message: dict[str, Any] = {"messageId": "m-1", "role": "ROLE_USER", "parts": list(parts)}
    if context_id is not None:
        message["contextId"] = context_id
    body = {"jsonrpc": "2.0", "id": 7, "method": method, "params": {"message": message}}
    response = client.post("/a2a", json=body, headers=A2A_HEADERS if headers is None else headers)
    assert response.status_code == 200
    result: dict[str, Any] = response.json()
    return result


def say(client: TestClient, text: str) -> str:
    message = send(client, {"text": text})["result"]["message"]
    assert message["role"] == "ROLE_AGENT"
    reply: str = message["parts"][0]["text"]
    return reply


def error_code(response: dict[str, Any]) -> int:
    code: int = response["error"]["code"]
    return code


def test_agent_card_has_the_required_fields(client: TestClient) -> None:
    card = client.get("/.well-known/agent-card.json").json()
    for field in (
        "name",
        "description",
        "version",
        "supportedInterfaces",
        "capabilities",
        "defaultInputModes",
        "defaultOutputModes",
        "skills",
    ):
        assert field in card
    [interface] = card["supportedInterfaces"]
    assert interface == {
        "url": "http://testserver/a2a",
        "protocolBinding": "JSONRPC",
        "protocolVersion": "1.0",
    }
    assert "securitySchemes" not in card


def test_public_url_overrides_the_interface_url() -> None:
    client = TestClient(create_app(public_url="https://agent.example.com"))
    card = client.get("/.well-known/agent-card.json").json()
    assert card["supportedInterfaces"][0]["url"] == "https://agent.example.com/a2a"


def test_send_message_echoes_as_an_agent_message(client: TestClient) -> None:
    response = send(client, {"text": "hello"})
    assert response["jsonrpc"] == "2.0"
    assert response["id"] == 7
    message = response["result"]["message"]
    assert message["parts"] == [{"text": "Echo: hello"}]
    assert message["contextId"] == "ctx-1"
    usage = message["metadata"]["usage"]
    assert usage["inputTokens"] > 0
    assert usage["outputTokens"] > 0


def test_missing_context_id_gets_a_new_one(client: TestClient) -> None:
    message = send(client, {"text": "hi"}, context_id=None)["result"]["message"]
    assert message["contextId"]


@pytest.mark.parametrize("trigger", list(SCENARIOS))
def test_triggers_return_their_canned_reply(client: TestClient, trigger: str) -> None:
    assert say(client, f"{trigger} please") == SCENARIOS[trigger][1]


def test_pii_trigger_contains_an_email(client: TestClient) -> None:
    assert "jan.kowalski@example.com" in say(client, "#pii")


def test_context_echoes_hub_parts_and_ignores_them_as_user_text(client: TestClient) -> None:
    response = send(
        client,
        {"text": "Be polite.", "metadata": {"guardrailHub": "governance"}},
        {"text": "Returns take 14 days.", "metadata": {"guardrailHub": "context"}},
        {"text": "#context"},
    )
    text = response["result"]["message"]["parts"][0]["text"]
    assert "[governance] Be polite." in text
    assert "[context] Returns take 14 days." in text


def test_long_trigger_returns_that_many_words(client: TestClient) -> None:
    assert len(say(client, "#long 50").split()) == 50


def test_slow_trigger_waits(client: TestClient) -> None:
    assert say(client, "#slow 0") == "Done after waiting 0 seconds."


def test_task_trigger_returns_a_completed_task(client: TestClient) -> None:
    task = send(client, {"text": "#task"})["result"]["task"]
    assert task["status"]["state"] == "TASK_STATE_COMPLETED"
    assert task["artifacts"][0]["parts"][0]["text"].startswith("Echo: #task")


def test_working_trigger_returns_an_unfinished_task(client: TestClient) -> None:
    task = send(client, {"text": "#working"})["result"]["task"]
    assert task["status"]["state"] == "TASK_STATE_WORKING"


def test_error_trigger_returns_a_json_rpc_error(client: TestClient) -> None:
    assert error_code(send(client, {"text": "#error"})) == -32603


def test_crash_trigger_returns_http_500(client: TestClient) -> None:
    body = {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "SendMessage",
        "params": {
            "message": {"messageId": "m", "role": "ROLE_USER", "parts": [{"text": "#crash"}]}
        },
    }
    assert client.post("/a2a", json=body, headers=A2A_HEADERS).status_code == 500


def test_missing_a2a_version_is_rejected(client: TestClient) -> None:
    assert error_code(send(client, {"text": "hi"}, headers={})) == -32009


def test_other_a2a_methods_are_unsupported(client: TestClient) -> None:
    assert error_code(send(client, {"text": "hi"}, method="GetTask")) == -32004


def test_unknown_methods_are_not_found(client: TestClient) -> None:
    assert error_code(send(client, {"text": "hi"}, method="message/send")) == -32601


def test_part_without_content_is_invalid_params(client: TestClient) -> None:
    assert error_code(send(client, {"mediaType": "text/plain"})) == -32602


def test_non_json_body_is_a_parse_error(client: TestClient) -> None:
    response = client.post("/a2a", content="not json", headers=A2A_HEADERS)
    assert error_code(response.json()) == -32700


def test_auth_header_is_required_when_configured() -> None:
    client = TestClient(create_app(auth_header="X-Api-Key", auth_value="s3cret"))
    card = client.get("/.well-known/agent-card.json").json()
    scheme = card["securitySchemes"]["apiKey"]["apiKeySecurityScheme"]
    assert scheme == {"location": "header", "name": "X-Api-Key"}

    body = {"jsonrpc": "2.0", "id": 1, "method": "SendMessage", "params": {}}
    assert client.post("/a2a", json=body, headers=A2A_HEADERS).status_code == 401
    ok = send(client, {"text": "hi"}, headers={**A2A_HEADERS, "X-Api-Key": "s3cret"})
    assert ok["result"]["message"]["parts"][0]["text"] == "Echo: hi"
