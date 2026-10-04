"""FR-16 models: MCP servers with a URL, auth and allowed tools."""

import re
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, BaseModel, Field, SecretStr, field_validator

# MCP tool names: letters, digits, underscore, hyphen, dot (e.g. get_order, search_docs)
TOOL_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


# --- auth (the discriminator is "type") ---
class NoAuth(BaseModel):
    type: Literal["none"]


class ApiKeyAuth(BaseModel):
    type: Literal["api_key"]
    header: str = Field(default="Authorization", min_length=1)
    api_key: SecretStr = Field(min_length=1)


class OAuthAuth(BaseModel):
    type: Literal["oauth"]
    token_url: AnyHttpUrl
    client_id: str = Field(min_length=1)
    client_secret: SecretStr = Field(min_length=1)
    scopes: list[str] = Field(default_factory=list)


Auth = Annotated[NoAuth | ApiKeyAuth | OAuthAuth, Field(discriminator="type")]


# --- what the API returns: never the secret itself ---
class AuthSummary(BaseModel):
    type: Literal["none", "api_key", "oauth"]
    header: str | None = None
    client_id: str | None = None
    scopes: list[str] = Field(default_factory=list)
    has_secret: bool


def summarize(auth: NoAuth | ApiKeyAuth | OAuthAuth) -> AuthSummary:
    if isinstance(auth, ApiKeyAuth):
        return AuthSummary(type="api_key", header=auth.header, has_secret=True)
    if isinstance(auth, OAuthAuth):
        return AuthSummary(
            type="oauth", client_id=auth.client_id, scopes=auth.scopes, has_secret=True
        )
    return AuthSummary(type="none", has_secret=False)


# --- request / response ---
def _valid_name(v: str) -> str:
    v = v.strip()
    if not v:
        raise ValueError("name must not be blank")
    return v


def valid_tools(tools: list[str]) -> list[str]:
    """MCP tool names, each valid and listed once."""
    bad = [t for t in tools if not TOOL_NAME.match(t)]
    if bad:
        raise ValueError(f"invalid tool names: {', '.join(bad)}")
    if len(set(tools)) != len(tools):
        raise ValueError("tools must be listed once each")
    return tools


class McpServerCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    url: AnyHttpUrl
    auth: Auth
    allowed_tools: list[str] = Field(min_length=1)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        return _valid_name(v)

    @field_validator("allowed_tools")
    @classmethod
    def valid_unique_tools(cls, tools: list[str]) -> list[str]:
        return valid_tools(tools)


class McpServerUpdate(BaseModel):
    """PATCH: only the fields sent change. `auth` replaces the whole auth, secret included."""

    name: str | None = Field(default=None, min_length=1, max_length=80)
    url: AnyHttpUrl | None = None
    auth: Auth | None = None
    allowed_tools: list[str] | None = Field(default=None, min_length=1)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str | None) -> str | None:
        return None if v is None else _valid_name(v)

    @field_validator("allowed_tools")
    @classmethod
    def valid_unique_tools(cls, tools: list[str] | None) -> list[str] | None:
        return None if tools is None else valid_tools(tools)


class McpServer(BaseModel):
    id: str
    name: str
    url: AnyHttpUrl
    auth: AuthSummary
    allowed_tools: list[str]
    agents: int = 0  # how many of the caller's agents may use it (FR-17)


# --- FR-17: per-agent access ---
class AgentMcpAccess(BaseModel):
    """PUT body: the server's tools this agent may call."""

    allowed_tools: list[str] = Field(min_length=1)

    @field_validator("allowed_tools")
    @classmethod
    def valid_unique_tools(cls, tools: list[str]) -> list[str]:
        return valid_tools(tools)


class AgentMcpServer(BaseModel):
    server_id: str
    name: str
    url: str
    available_tools: list[str]  # everything the server offers
    allowed_tools: list[str]  # what this agent may call


class McpGrant(BaseModel):
    """What the agent is told on each call (A2A params.metadata.guardrailHub.mcpServers).
    Never credentials: the hub keeps them."""

    id: str
    name: str
    url: str
    allowed_tools: list[str] = Field(alias="allowedTools")

    model_config = {"populate_by_name": True}

    def for_agent(self) -> dict[str, object]:
        return self.model_dump(by_alias=True)
