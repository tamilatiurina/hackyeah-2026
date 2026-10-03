import re
from typing import Any, Self

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    HttpUrl,
    SecretStr,
    field_validator,
    model_validator,
)
from pydantic.alias_generators import to_camel

_HEADER_NAME = re.compile(r"^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$")
_FORBIDDEN_AUTH_HEADERS = {
    "connection",
    "content-length",
    "host",
    "proxy-connection",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
}


class AuthHeader(BaseModel):
    name: str = Field(default="Authorization", min_length=1)
    value: SecretStr

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        if not _HEADER_NAME.fullmatch(value):
            raise ValueError("auth header name is not a valid HTTP header name")
        if value.lower() in _FORBIDDEN_AUTH_HEADERS:
            raise ValueError("auth header cannot control HTTP connection routing")
        return value

    @field_validator("value", mode="before")
    @classmethod
    def validate_value(cls, value: object) -> str:
        if not isinstance(value, str) or not value:
            raise ValueError("auth header value must be a non-empty string")
        try:
            value.encode("ascii")
        except UnicodeEncodeError as error:
            raise ValueError("auth header value must contain only ASCII characters") from error
        if any(ord(char) < 32 and char != "\t" or ord(char) == 127 for char in value):
            raise ValueError("auth header value contains invalid control characters")
        return value


# --- A2A 1.0 Agent Card (docs/agent-contract-a2a.md). JSON uses the spec's camelCase names. ---
A2A_PROTOCOL_VERSION = "1.0"
A2A_BINDING = "JSONRPC"
AGENT_CARD_PATH = "/.well-known/agent-card.json"


class _A2AModel(BaseModel):
    # Validates the fields the hub relies on; the card may carry any others.
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow")


class AgentInterface(_A2AModel):
    url: HttpUrl
    protocol_binding: str
    protocol_version: str


class AgentSkill(_A2AModel):
    id: str
    name: str
    description: str
    tags: list[str]
    examples: list[str] = Field(default_factory=list)


class AgentCapabilities(_A2AModel):
    streaming: bool | None = None
    push_notifications: bool | None = None


class AgentCard(_A2AModel):
    name: str = Field(min_length=1)
    description: str
    version: str
    supported_interfaces: list[AgentInterface] = Field(min_length=1)
    capabilities: AgentCapabilities
    default_input_modes: list[str]
    default_output_modes: list[str]
    skills: list[AgentSkill]

    def jsonrpc_interface(self) -> AgentInterface | None:
        """The interface the hub calls: JSON-RPC binding, A2A 1.0."""
        for interface in self.supported_interfaces:
            if (
                interface.protocol_binding == A2A_BINDING
                and interface.protocol_version == A2A_PROTOCOL_VERSION
            ):
                return interface
        return None


class AgentRegistration(BaseModel):
    base_url: HttpUrl
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1_000)
    auth_header: AuthHeader | None = None


class AgentUpdate(BaseModel):
    """PATCH body (FR-02); every field optional.

    `auth_header`: an object replaces the stored header, null removes it, omitted keeps it.
    """

    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1_000)
    base_url: HttpUrl | None = None
    auth_header: AuthHeader | None = None

    @model_validator(mode="after")
    def no_nulls_for_required_fields(self) -> Self:
        for field in ("name", "description", "base_url"):
            if field in self.model_fields_set and getattr(self, field) is None:
                raise ValueError(f"{field} cannot be null")
        return self


class Agent(BaseModel):
    id: str
    name: str
    description: str
    base_url: HttpUrl
    upstream_url: HttpUrl
    """The agent's A2A JSON-RPC endpoint, taken from its Agent Card."""
    auth_header_name: str | None
    agent_card: dict[str, Any] | None
    """Snapshot of the Agent Card; null for agents registered before A2A."""
    config_version: int = 1
    """FR-02: goes up by one every time a saved change alters the agent's configuration."""


class AgentList(BaseModel):
    data: list[Agent]
    total: int
