"""Outbound HTTP that reaches public addresses only.

Several routes fetch a URL a signed-in user chose. Without a policy those routes are a
proxy into whatever the API host can reach: a link-local metadata service, a database on
a private address, an admin port on loopback.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import TYPE_CHECKING

import httpx2

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

ALLOWED_SCHEMES = frozenset({"http", "https"})
# RFC 6052 translation: an IPv4 address sits in the low 32 bits, which `is_global` reads
# as a public IPv6 address however private the embedded address is.
NAT64_WELL_KNOWN = ipaddress.IPv6Network("64:ff9b::/96")
# RFC 8215 leaves the translation length in this prefix to the operator, so the embedded
# address cannot be located reliably. Nothing public is reachable through it either way.
NAT64_LOCAL_USE = ipaddress.IPv6Network("64:ff9b:1::/48")

type Resolver = Callable[[str], Awaitable[list[str]]]


class BlockedAddressError(Exception):
    """A request named a scheme, a host, or an address the outbound policy refuses."""


def is_public_address(address: str) -> bool:
    """Whether an address belongs to a host on the public internet.

    Args:
        address: An IPv4 or IPv6 address in its usual text form.

    Returns:
        False for loopback, private, link-local, carrier-grade NAT, reserved, and
        unparsable addresses, and for any IPv6 form that carries one of those inside it.
    """
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address):
        if ip in NAT64_LOCAL_USE:
            return False
        if ip in NAT64_WELL_KNOWN:
            return is_public_address(str(ipaddress.IPv4Address(int(ip) & 0xFFFFFFFF)))
    return ip.is_global


async def system_resolver(host: str) -> list[str]:
    """Every address the system resolver holds for a host."""
    loop = asyncio.get_running_loop()
    infos = await loop.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def pinned_transport() -> httpx2.AsyncHTTPTransport:
    """Build the transport that carries requests whose host has been replaced by an address.

    Connections are not kept alive. The pool keys a connection by the host in the URL, which
    for a pinned request is an address, so a kept connection would be handed to any other
    name that resolves to the same address, over a session that authenticated only the first.
    """
    return httpx2.AsyncHTTPTransport(limits=httpx2.Limits(max_keepalive_connections=0))


class PublicOnlyTransport(httpx2.AsyncBaseTransport):
    """Refuses any request that would reach an address off the public internet.

    The request connects to the address that was checked, rather than to the name, so a
    name that answers differently on a second lookup cannot move the connection. The name
    stays in the Host header and in the TLS server name, so a certificate still has to
    match the host the caller asked for.
    """

    def __init__(self, inner: httpx2.AsyncBaseTransport, *, resolve: Resolver | None = None):
        self._inner = inner
        self._resolve = resolve or system_resolver

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        """Check where the request would go, then send it to the address that was checked."""
        host = request.url.host
        address = await self._checked_address(request.url.scheme, host)
        # A new request, because the caller's own request is what httpx2 builds the next
        # redirect hop from, and that hop has to start from the name rather than the address.
        pinned = httpx2.Request(
            method=request.method,
            url=request.url.copy_with(host=address),
            headers=request.headers,
            stream=request.stream,
            extensions={**request.extensions, "sni_hostname": host},
        )
        return await self._inner.handle_async_request(pinned)

    async def aclose(self) -> None:
        """Release the underlying transport."""
        await self._inner.aclose()

    async def _checked_address(self, scheme: str, host: str) -> str:
        if scheme not in ALLOWED_SCHEMES:
            msg = f"{scheme} is not a scheme this API fetches"
            raise BlockedAddressError(msg)
        addresses = await self._addresses_of(host)
        # Every answer has to pass, not just the one that gets used: a host that mixes a
        # public address with a private one is a host that can hand out either.
        if not addresses or not all(is_public_address(address) for address in addresses):
            msg = f"{host} does not resolve to a public address"
            raise BlockedAddressError(msg)
        return addresses[0]

    async def _addresses_of(self, host: str) -> list[str]:
        try:
            ipaddress.ip_address(host)
        except ValueError:
            pass
        else:
            return [host]
        try:
            return await self._resolve(host)
        except OSError as exc:
            msg = f"{host} does not resolve"
            raise BlockedAddressError(msg) from exc


def public_only_client(timeout: float) -> httpx2.AsyncClient:
    """Build the client for every outbound request this API makes.

    Redirects are followed, because the policy sits under the redirect machinery and sees
    each hop as its own request.

    Args:
        timeout: Seconds any single request may take.
    """
    return httpx2.AsyncClient(
        transport=PublicOnlyTransport(pinned_transport()),
        timeout=timeout,
        follow_redirects=True,
    )
