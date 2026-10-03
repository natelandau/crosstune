"""Search Internet Archive for audio items."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

from crosstune.links.fetch import get_json
from crosstune.links.search.types import (
    MAX_HITS,
    AdapterAnswer,
    SearchHit,
    build_hit,
    collect,
    field,
    items,
    text,
)

if TYPE_CHECKING:
    import httpx2

SEARCH_URL = "https://archive.org/advancedsearch.php"
DETAILS_URL = "https://archive.org/details/{identifier}"
_WORD = re.compile(r"\w+")


async def search(
    query: str,
    country: str,
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> AdapterAnswer:
    """Search audio items by the words of the query.

    Args:
        query: The search text.
        country: Passed through as the served country; Internet Archive has no storefronts.
        client: The outbound client.
        timeout: The per-request timeout in seconds.

    Returns:
        AdapterAnswer: Up to MAX_HITS items, each linking to its details page.
    """
    # Lowercase words only. The service's query rewriter rejects a bare "/" and a quoted
    # operator, treats uppercase AND, OR, and NOT as operators, and a quoted phrase
    # matches only word for word, which a tune name with its type appended rarely does.
    words = _WORD.findall(query.lower())
    if not words:
        return AdapterAnswer([], country)
    body = await get_json(
        client,
        SEARCH_URL,
        params={
            "q": f"({' '.join(words)}) AND mediatype:audio",
            "fl[]": ["identifier", "title", "creator"],
            "rows": str(MAX_HITS),
            "output": "json",
        },
        timeout=timeout,
    )
    hits = collect(_hit(doc) for doc in items(field(field(body, "response"), "docs")))
    return AdapterAnswer(hits, country)


def _first(value: object) -> str | None:
    return text(value[0]) if isinstance(value, list) and value else text(value)


def _creators(value: object) -> str | None:
    if not isinstance(value, list):
        return text(value)
    names = [name for name in (text(item) for item in value) if name]
    return ", ".join(names) or None


def _hit(doc: object) -> SearchHit | None:
    identifier = text(field(doc, "identifier"))
    if identifier is None:
        return None
    hit = build_hit(
        DETAILS_URL.format(identifier=identifier),
        provider="internet_archive",
        title=_first(field(doc, "title")),
        subtitle=_creators(field(doc, "creator")),
    )
    # An identifier the details-page pattern cannot carry whole would link a different item.
    return hit if hit and hit.provider_ref == identifier else None
