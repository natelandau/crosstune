"""Outbound requests reach public addresses only, on every redirect hop."""

from __future__ import annotations

import asyncio

import httpx2
import pytest

from crosstune.http import (
    BlockedAddressError,
    PublicOnlyTransport,
    is_public_address,
    pinned_transport,
    system_resolver,
)

pytestmark = pytest.mark.anyio

METADATA = "169.254.169.254"


class RecordingTransport(httpx2.AsyncBaseTransport):
    """An inner transport that records what the guard let through."""

    def __init__(self, handler=None) -> None:
        self.requests: list[httpx2.Request] = []
        self._handler = handler or (lambda _: httpx2.Response(200, text="ok"))

    async def handle_async_request(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        return self._handler(request)


def guarded(
    hosts: dict[str, list[str]], handler=None
) -> tuple[PublicOnlyTransport, RecordingTransport]:
    """A guard over a recording transport, resolving names from a fixed table."""

    async def resolve(host: str) -> list[str]:
        try:
            return hosts[host]
        except KeyError:
            msg = f"unknown host {host}"
            raise OSError(msg) from None

    inner = RecordingTransport(handler)
    return PublicOnlyTransport(inner, resolve=resolve), inner


@pytest.mark.parametrize(
    "address",
    [
        "127.0.0.1",
        "10.0.0.1",
        "172.16.0.1",
        "192.168.1.1",
        METADATA,
        "0.0.0.0",  # noqa: S104 -- an address the guard must reject, not one it binds
        "100.64.0.1",
        "::1",
        "fc00::1",
        "fe80::1",
        "::ffff:127.0.0.1",
        f"::ffff:{METADATA}",
        "2002:7f00:0001::1",
        "64:ff9b::7f00:1",
        "64:ff9b:1::a00:1",
    ],
)
def test_non_public_addresses_are_refused(address: str) -> None:
    assert not is_public_address(address)


@pytest.mark.parametrize("address", ["", "example.com", "999.1.1.1", "not an address"])
def test_anything_that_is_not_an_address_is_refused(address: str) -> None:
    assert not is_public_address(address)


@pytest.mark.parametrize(
    "address", ["8.8.8.8", "1.1.1.1", "2001:4860:4860::8888", "64:ff9b::808:808"]
)
def test_public_addresses_are_allowed(address: str) -> None:
    assert is_public_address(address)


async def test_the_system_resolver_reads_the_hosts_file() -> None:
    assert set(await system_resolver("localhost")) & {"127.0.0.1", "::1"}


async def test_a_host_on_a_private_address_never_reaches_the_network() -> None:
    transport, inner = guarded({"internal.example": ["10.0.0.5"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        with pytest.raises(BlockedAddressError):
            await client.get("https://internal.example/")
    assert inner.requests == []


async def test_a_host_with_one_private_address_among_several_is_refused() -> None:
    transport, inner = guarded({"mixed.example": ["93.184.216.34", "127.0.0.1"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        with pytest.raises(BlockedAddressError):
            await client.get("https://mixed.example/")
    assert inner.requests == []


async def test_a_bare_private_ip_is_refused_without_a_lookup() -> None:
    transport, inner = guarded({})
    async with httpx2.AsyncClient(transport=transport) as client:
        with pytest.raises(BlockedAddressError):
            await client.get(f"http://{METADATA}/latest/meta-data/")
    assert inner.requests == []


async def test_a_host_that_does_not_resolve_is_refused() -> None:
    transport, inner = guarded({})
    async with httpx2.AsyncClient(transport=transport) as client:
        with pytest.raises(BlockedAddressError):
            await client.get("https://nxdomain.example/")
    assert inner.requests == []


@pytest.mark.parametrize("url", ["file:///etc/passwd", "gopher://example.com/x"])
async def test_a_non_http_scheme_is_refused(url: str) -> None:
    transport, inner = guarded({"example.com": ["93.184.216.34"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        with pytest.raises(BlockedAddressError):
            await client.get(url)
    assert inner.requests == []


async def test_a_public_host_is_fetched_at_the_address_that_was_checked() -> None:
    transport, inner = guarded({"example.com": ["93.184.216.34"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        response = await client.get("https://example.com/page")
    assert response.status_code == 200
    sent = inner.requests[0]
    # Pinning the connection to the checked address is what closes the rebinding window;
    # the name has to survive in the Host header and the SNI for TLS to still verify it.
    assert sent.url.host == "93.184.216.34"
    assert sent.url.path == "/page"
    assert sent.headers["Host"] == "example.com"
    assert sent.extensions["sni_hostname"] == "example.com"


async def test_a_non_default_port_survives_pinning() -> None:
    transport, inner = guarded({"example.com": ["93.184.216.34"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        await client.get("https://example.com:8443/page")
    sent = inner.requests[0]
    assert sent.url.host == "93.184.216.34"
    assert sent.url.port == 8443
    assert sent.headers["Host"] == "example.com:8443"


async def test_an_ipv6_host_is_pinned_in_brackets() -> None:
    transport, inner = guarded({"v6.example": ["2001:4860:4860::8888"]})
    async with httpx2.AsyncClient(transport=transport) as client:
        await client.get("https://v6.example/page")
    sent = inner.requests[0]
    assert sent.url.host == "2001:4860:4860::8888"
    assert str(sent.url) == "https://[2001:4860:4860::8888]/page"


async def test_a_redirect_to_a_private_address_is_refused() -> None:
    """The hole this guard closes: a public first hop that hands back a metadata address."""
    redirect = httpx2.Response(302, headers={"Location": f"http://{METADATA}/latest/meta-data/"})
    transport, inner = guarded({"public.example": ["93.184.216.34"]}, lambda _: redirect)
    async with httpx2.AsyncClient(transport=transport, follow_redirects=True) as client:
        with pytest.raises(BlockedAddressError):
            await client.get("https://public.example/")
    assert [str(r.url) for r in inner.requests] == ["https://93.184.216.34/"]


async def test_a_pinned_transport_opens_a_connection_per_request() -> None:
    """A kept connection would be handed to any other name resolving to the same address.

    It would carry a session that authenticated only the first of those names.
    """
    connections = 0

    async def serve(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        nonlocal connections
        connections += 1
        try:
            while True:
                await reader.readuntil(b"\r\n\r\n")
                writer.write(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok")
                await writer.drain()
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            writer.close()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    port = server.sockets[0].getsockname()[1]
    async with server, httpx2.AsyncClient(transport=pinned_transport()) as client:
        await client.get(f"http://127.0.0.1:{port}/", headers={"Host": "one.example"})
        await client.get(f"http://127.0.0.1:{port}/", headers={"Host": "two.example"})
    assert connections == 2
