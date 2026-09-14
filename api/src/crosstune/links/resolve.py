"""Fetch a title and artwork for a pasted URL. Failure is a link with no title, never an error."""

from __future__ import annotations

import logging
from dataclasses import dataclass, replace
from typing import TYPE_CHECKING

from crosstune.links.detect import detect_provider, normalize_url
from crosstune.links.opengraph import PageMeta, parse_open_graph

if TYPE_CHECKING:
    import httpx2

log = logging.getLogger(__name__)

OEMBED_ENDPOINTS = {
    "youtube": "https://www.youtube.com/oembed",
    "spotify": "https://open.spotify.com/oembed",
    "soundcloud": "https://soundcloud.com/oembed",
}
ITUNES_LOOKUP = "https://itunes.apple.com/lookup"
ARCHIVE_METADATA = "https://archive.org/metadata/{identifier}/metadata"
ARCHIVE_ARTWORK = "https://archive.org/services/img/{identifier}"
MAX_PAGE_BYTES = 512_000


@dataclass(frozen=True)
class ResolvedLink:
    """The outcome of resolving a pasted URL: what we could tell about it."""

    url: str
    provider: str
    provider_ref: str | None
    title: str | None
    artwork_url: str | None


def unresolved_link(url: str) -> ResolvedLink:
    """What a URL yields with nothing fetched: canonical form, detected provider, no title."""
    provider, ref = detect_provider(url)
    return ResolvedLink(
        url=normalize_url(url, provider, ref),
        provider=provider,
        provider_ref=ref,
        title=None,
        artwork_url=None,
    )


async def resolve_link(
    url: str,
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> ResolvedLink:
    """Detect the provider, canonicalize the URL, and try to fetch metadata."""
    link = unresolved_link(url)
    title: str | None = None
    artwork: str | None = None
    ref = link.provider_ref
    try:
        if link.provider in OEMBED_ENDPOINTS:
            title, artwork = await _oembed(
                client, OEMBED_ENDPOINTS[link.provider], link.url, timeout
            )
        elif link.provider == "apple_music" and link.provider_ref:
            title, artwork = await _itunes(client, link.provider_ref, timeout)
        elif link.provider == "internet_archive" and link.provider_ref:
            title, artwork = await _internet_archive(client, link.provider_ref, timeout)
        else:
            page = await _open_graph(client, link.url, timeout)
            title, artwork = page.title, page.image
            if link.provider == "bandcamp":
                ref = page.bandcamp_ref
    except Exception:  # noqa: BLE001  -- any upstream failure degrades to an untitled link
        log.warning("link resolution failed", extra={"url": link.url, "provider": link.provider})
    return replace(link, title=title, artwork_url=artwork, provider_ref=ref)


async def _oembed(
    client: httpx2.AsyncClient,
    endpoint: str,
    url: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> tuple[str | None, str | None]:
    response = await client.get(endpoint, params={"url": url, "format": "json"}, timeout=timeout)
    response.raise_for_status()
    body = response.json()
    return body.get("title"), body.get("thumbnail_url")


async def _itunes(
    client: httpx2.AsyncClient,
    ref: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> tuple[str | None, str | None]:
    response = await client.get(ITUNES_LOOKUP, params={"id": ref}, timeout=timeout)
    response.raise_for_status()
    results = response.json().get("results") or []
    if not results:
        return None, None
    item = results[0]
    name = item.get("trackName") or item.get("collectionName")
    artist = item.get("artistName")
    title = f"{name} - {artist}" if name and artist else name or artist
    return title, item.get("artworkUrl100")


def _first_text(value: object) -> str | None:
    if isinstance(value, list):
        value = value[0] if value else None
    return value if isinstance(value, str) and value else None


async def _internet_archive(
    client: httpx2.AsyncClient,
    identifier: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> tuple[str | None, str | None]:
    # The item page's og:title carries a site suffix; the metadata API has clean fields.
    response = await client.get(ARCHIVE_METADATA.format(identifier=identifier), timeout=timeout)
    response.raise_for_status()
    meta = response.json().get("result")
    # An unknown identifier still answers 200, with an error message and no result.
    if not isinstance(meta, dict) or not meta:
        return None, None
    name = _first_text(meta.get("title"))
    creator = _first_text(meta.get("creator"))
    title = f"{name} - {creator}" if name and creator else name or creator
    return title, ARCHIVE_ARTWORK.format(identifier=identifier)


async def _open_graph(
    client: httpx2.AsyncClient,
    url: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> PageMeta:
    # Streamed and capped: the page is an arbitrary third-party URL and the og tags
    # a resolver needs are in the head.
    chunks: list[bytes] = []
    read = 0
    async with client.stream(
        "GET", url, timeout=timeout, headers={"Accept": "text/html"}
    ) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            chunks.append(chunk)
            read += len(chunk)
            if read >= MAX_PAGE_BYTES:
                break
    body = b"".join(chunks)[:MAX_PAGE_BYTES]
    return parse_open_graph(body.decode("utf-8", errors="replace"))
