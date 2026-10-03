import re
from enum import StrEnum

from pydantic import BaseModel, Field, HttpUrl, SecretStr, field_validator

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


class MessageFormat(StrEnum):
    JSON = "json"
    TEXT = "text"


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


class AgentRegistration(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str = Field(max_length=1_000)
    upstream_url: HttpUrl
    auth_header: AuthHeader | None = None
    request_format: MessageFormat
    response_format: MessageFormat


class Agent(BaseModel):
    id: str
    name: str
    description: str
    upstream_url: HttpUrl
    auth_header_name: str | None
    request_format: MessageFormat
    response_format: MessageFormat


class AgentList(BaseModel):
    data: list[Agent]
    total: int
