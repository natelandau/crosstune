"""Fetch an imported recording's audio from the page it came from."""

from __future__ import annotations

import asyncio
import contextlib
from dataclasses import dataclass
from typing import TYPE_CHECKING, BinaryIO
from urllib.parse import urlsplit, urlunsplit

import httpx2

from crosstune.links.detect import SLIPPERY_HILL_ORIGIN, slippery_hill_file_url
from crosstune.links.fetch import read_page_text
from crosstune.links.resolve import unresolved_link
from crosstune.links.slippery_hill import parse_tune_page
from crosstune.vocabulary import IMPORTABLE_PROVIDERS

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

    from crosstune.models import Recording

IMPORT_HOST = urlsplit(SLIPPERY_HILL_ORIGIN).netloc
IMPORT_MIME = "audio/mpeg"
MAX_REDIRECTS = 5
# A cap-sized file over a link as slow as about 1.33 Mbit/s; past this the host is
# treated as unreachable and the job retries.
DOWNLOAD_TIMEOUT_SECONDS = 300.0
GONE_STATUSES = frozenset({404, 410})
NO_AUDIO = "Couldn't find the audio on Slippery-Hill"
TOO_LARGE = "File too large"
OVER_QUOTA = "Storage quota exceeded"
PREMIUM_REQUIRED_IMPORT = "Premium required"


@dataclass(frozen=True)
class FetchedImport:
    """A downloaded import: its size in bytes, and the year and artist its page gives, if any."""

    size: int
    year: int | None
    artist: str | None


class ImportRefused(Exception):  # noqa: N818 -- a refusal, not an error; the name is the job's contract
    """An import no retry can fix. The message is the copy a client shows."""


async def fetch_import(
    client: httpx2.AsyncClient,
    recording: Recording,
    path: Path,
    *,
    max_bytes: int,
    room_bytes: int | None = None,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> FetchedImport:
    """Download the audio an imported recording's page points at into a local file.

    The file is found by resolving `origin_url` again, never from a URL a client sent,
    and every request stays on Slippery-Hill's host. Nothing is left at `path` unless
    the download succeeds.

    Args:
        client: The outbound client, which enforces the public-address policy.
        recording: The import whose `origin_url` names the page or file.
        path: Where the file is written.
        max_bytes: The largest file accepted.
        room_bytes: The owner's storage left, or None when only `max_bytes` applies.
        timeout: The per-request timeout.

    Returns:
        FetchedImport: The file's size, and the page's year and artist when a page was read.

    Raises:
        ImportRefused: When the page has no audio, the file is gone, a request leaves
            the host, or the file is larger than `max_bytes` or `room_bytes`.
        httpx2.TimeoutException: When the whole download outlasts DOWNLOAD_TIMEOUT_SECONDS.
    """
    try:
        async with asyncio.timeout(DOWNLOAD_TIMEOUT_SECONDS):
            ref, year, artist = await _file_ref(client, recording.origin_url or "", timeout)
            if ref is None:
                raise ImportRefused(NO_AUDIO)
            size = await _download(
                client,
                slippery_hill_file_url(ref),
                path,
                max_bytes=max_bytes,
                room_bytes=room_bytes,
                timeout=timeout,
            )
            return FetchedImport(size=size, year=year, artist=artist)
    except TimeoutError as exc:
        msg = f"the download took longer than {DOWNLOAD_TIMEOUT_SECONDS} seconds"
        raise httpx2.TimeoutException(msg) from exc


async def _download(
    client: httpx2.AsyncClient,
    url: str,
    path: Path,
    *,
    max_bytes: int,
    room_bytes: int | None,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> int:
    """Stream the file at `url` to `path`, removing a partial file on any failure."""
    done = False
    try:
        async with _get(client, url, timeout) as response:
            size = await _save(response, path, max_bytes=max_bytes, room_bytes=room_bytes)
        done = True
    except httpx2.HTTPStatusError as exc:
        # The page named this file, so a file the site says is gone won't come back.
        if exc.response.status_code in GONE_STATUSES:
            raise ImportRefused(NO_AUDIO) from exc
        raise
    finally:
        if not done:
            await asyncio.to_thread(path.unlink, missing_ok=True)
    return size


def _open_for_write(path: Path) -> BinaryIO:
    return path.open("wb")


async def _save(
    response: httpx2.Response, path: Path, *, max_bytes: int, room_bytes: int | None
) -> int:
    """Write a response body to `path`, refusing it as soon as it passes either limit.

    A file over the per-file cap is refused as too large even when the room left is
    smaller, since no space the owner frees would let it in. Without a declared length,
    a body cut off at the room left can only be refused as over the quota.
    """
    declared = response.headers.get("Content-Length", "")
    if declared.isdigit() and int(declared) > max_bytes:
        raise ImportRefused(TOO_LARGE)
    if declared.isdigit() and room_bytes is not None and int(declared) > room_bytes:
        raise ImportRefused(OVER_QUOTA)
    limit = max_bytes if room_bytes is None else min(max_bytes, room_bytes)
    size = 0
    file = await asyncio.to_thread(_open_for_write, path)
    try:
        async for chunk in response.aiter_bytes():
            size += len(chunk)
            if size > limit:
                raise ImportRefused(TOO_LARGE if size > max_bytes else OVER_QUOTA)
            await asyncio.to_thread(file.write, chunk)
    finally:
        await asyncio.to_thread(file.close)
    return size


async def _file_ref(
    client: httpx2.AsyncClient,
    url: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> tuple[str | None, int | None, str | None]:
    """The file ref `url` names and its page's year and artist, reading the page when it is not a file URL.

    Unlike `resolve_link`, a page that cannot be fetched raises, so the job retries
    instead of reporting a page with no audio. A file URL has no page, so no year or artist.
    """
    link = unresolved_link(url)
    if link.provider not in IMPORTABLE_PROVIDERS:
        return None, None, None
    if link.provider_ref is not None:
        return link.provider_ref, None, None
    # Any host the detector calls Slippery-Hill serves the same page, and `_get` only
    # requests the canonical one.
    page = urlunsplit(urlsplit(link.url)._replace(scheme="https", netloc=IMPORT_HOST))
    async with _get(client, page, timeout) as response:
        html = await read_page_text(response)
    page_info = await asyncio.to_thread(parse_tune_page, html)
    return page_info.ref, page_info.year, page_info.artist


@contextlib.asynccontextmanager
async def _get(
    client: httpx2.AsyncClient,
    url: str,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> AsyncGenerator[httpx2.Response]:
    """Stream a GET, following redirects only while they stay on Slippery-Hill's host.

    The client's own redirect handling would request the next hop before anyone could
    look at its host, so hops are followed here, each checked before it is sent.
    """
    for _ in range(MAX_REDIRECTS + 1):
        target = httpx2.URL(url)
        if target.scheme != "https" or target.host != IMPORT_HOST or target.port not in (None, 443):
            raise ImportRefused(NO_AUDIO)
        async with client.stream(
            "GET", target, timeout=timeout, follow_redirects=False
        ) as response:
            if not response.has_redirect_location:
                response.raise_for_status()
                yield response
                return
            url = str(response.url.join(response.headers["Location"]))
    raise ImportRefused(NO_AUDIO)
