import socket
from collections.abc import AsyncIterator
from dataclasses import dataclass
from ipaddress import IPv4Address, IPv6Address, ip_address

import httpx
from fastapi import HTTPException, status
from fastapi.concurrency import run_in_threadpool
from pydantic import HttpUrl

from app.core.auth import Me
from supabase import Client


@dataclass(frozen=True)
class AgentDatabase:
    client: Client
    owner_id: str


@dataclass(frozen=True)
class ResolvedUpstream:
    """A public upstream URL pinned to the IP address that was validated."""

    url: httpx.URL
    host_header: str
    sni_hostname: str


def get_agent_database(user: Me) -> AgentDatabase:
    """The signed-in user's agents: their own Supabase client and their id as the owner."""
    return AgentDatabase(client=user.client, owner_id=user.id)


async def ensure_public_upstream(url: HttpUrl) -> ResolvedUpstream:
    """Resolve and pin an upstream to a validated public IP address."""
    if url.username is not None or url.password is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Upstream URL must not contain credentials",
        )

    host = url.host
    if host is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Upstream URL must have a hostname",
        )
    host = host.removeprefix("[").removesuffix("]")

    try:
        addresses: set[IPv4Address | IPv6Address] = {ip_address(host)}
    except ValueError:
        port = url.port or (443 if url.scheme == "https" else 80)
        try:
            records = await run_in_threadpool(
                socket.getaddrinfo,
                host,
                port,
                0,
                socket.SOCK_STREAM,
            )
        except socket.gaierror as error:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Upstream hostname could not be resolved",
            ) from error
        addresses = {ip_address(record[4][0]) for record in records}

    if not addresses or any(not address.is_global for address in addresses):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail="Upstream URL must resolve only to public IP addresses",
        )

    # The request connects to this exact address, not to the hostname again.
    # This closes the DNS-rebinding gap between validation and connection.
    address = sorted(addresses, key=lambda item: (item.version != 4, str(item)))[0]
    original_url = httpx.URL(str(url))
    return ResolvedUpstream(
        url=original_url.copy_with(host=str(address)),
        host_header=original_url.netloc.decode("ascii"),
        sni_hostname=original_url.host,
    )


async def get_http_client() -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(follow_redirects=False, timeout=5.0) as client:
        yield client
