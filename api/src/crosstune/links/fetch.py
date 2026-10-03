"""Bounded JSON fetches from third-party services."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from collections.abc import Mapping, Sequence

    import httpx2

MAX_JSON_BYTES = 256_000


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
