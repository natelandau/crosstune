"""Search the Apple Music catalog for songs."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.links.fetch import get_json
from crosstune.links.search.types import (
    MAX_HITS,
    AdapterAnswer,
    SearchHit,
    auth_errors,
    build_hit,
    collect,
    field,
    items,
    text,
    with_region_fallback,
)

if TYPE_CHECKING:
    import httpx2

    from crosstune.links.search.tokens import AppleMusicToken
    from crosstune.links.search.types import Adapter

SEARCH_URL = "https://api.music.apple.com/v1/catalog/{storefront}/search"
ARTWORK_SIZE = "300x300"


def adapter(token: AppleMusicToken) -> Adapter:
    """Bind the developer token so the registry can call every adapter the same way.

    Args:
        token: The signed developer token Apple requires on every catalog request.

    Returns:
        Adapter: The Apple Music search.
    """

    async def search(
        query: str,
        country: str,
        client: httpx2.AsyncClient,
        timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
    ) -> AdapterAnswer:
        async def fetch(storefront: str) -> object:
            return await get_json(
                client,
                SEARCH_URL.format(storefront=storefront.lower()),
                params={"term": query, "types": "songs", "limit": str(MAX_HITS)},
                headers={"Authorization": f"Bearer {token.get()}"},
                timeout=timeout,
            )

        with auth_errors(token):
            body, served = await with_region_fallback(country, fetch)
        songs = field(field(field(body, "results"), "songs"), "data")
        return AdapterAnswer(collect(_hit(song) for song in items(songs)), served)

    return search


def _hit(song: object) -> SearchHit | None:
    attributes = field(song, "attributes")
    artist, album = text(field(attributes, "artistName")), text(field(attributes, "albumName"))
    artwork = text(field(field(attributes, "artwork"), "url"))
    return build_hit(
        field(attributes, "url"),
        provider="apple_music",
        title=field(attributes, "name"),
        subtitle=" · ".join(part for part in (artist, album) if part) or None,
        artwork_url=artwork.replace("{w}x{h}", ARTWORK_SIZE) if artwork else None,
    )
