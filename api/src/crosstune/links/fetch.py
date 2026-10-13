"""Bounded reads of pages and JSON bodies from third-party services."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    import httpx2

MAX_JSON_BYTES = 256_000
MAX_PAGE_BYTES = 512_000


async def read_page_text(response: httpx2.Response) -> str:
    """Read at most MAX_PAGE_BYTES of a streamed page as text.

    A page is an arbitrary third-party document whose useful data sits near the top, so
    the rest is never downloaded, and bytes that are not UTF-8 never fail the read.

    Args:
        response: An open streamed response whose status the caller has checked.

    Returns:
        str: The page's first MAX_PAGE_BYTES, decoded.
    """
    chunks: list[bytes] = []
    read = 0
    async for chunk in response.aiter_bytes():
        chunks.append(chunk)
        read += len(chunk)
        if read >= MAX_PAGE_BYTES:
            break
    return b"".join(chunks)[:MAX_PAGE_BYTES].decode("utf-8", errors="replace")


async def get_json(
    client: httpx2.AsyncClient,
    url: str,
    *,
    params: Mapping[str, str | Sequence[str]] | None = None,
    headers: dict[str, str] | None = None,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> Any:
    """Fetch and parse a JSON body from a service the API does not control.

    Args:
        client: The outbound client, which enforces the address policy.
        url: The endpoint to call.
        params: Query parameters, a sequence for a key that repeats.
        headers: Extra request headers, such as a bearer token.
        timeout: The per-request timeout in seconds.

    Returns:
        Any: The parsed body.

    Raises:
        ValueError: If the body is over MAX_JSON_BYTES.
    """
    # Streamed and capped like a page, but a JSON body cut short cannot parse, so one over
    # the cap is refused outright.
    chunks: list[bytes] = []
    read = 0
    async with client.stream(
        "GET", url, params=params, headers=headers, timeout=timeout
    ) as response:
        response.raise_for_status()
        async for chunk in response.aiter_bytes():
            read += len(chunk)
            if read > MAX_JSON_BYTES:
                msg = f"response over {MAX_JSON_BYTES} bytes"
                raise ValueError(msg)
            chunks.append(chunk)
    return json.loads(b"".join(chunks))
