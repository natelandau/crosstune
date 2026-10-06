"""Search the TIDAL catalog for tracks."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING
from urllib.parse import quote

import httpx2

from crosstune.http import BlockedAddressError
from crosstune.links.fetch import get_json
from crosstune.links.search.types import (
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
from crosstune.vocabulary import Provider

if TYPE_CHECKING:
    from crosstune.links.search.backoff import Backoff
    from crosstune.links.search.tokens import TidalToken
    from crosstune.links.search.types import Adapter

log = logging.getLogger(__name__)


SEARCH_URL = "https://openapi.tidal.com/v2/searchResults"
TRACKS_URL = "https://openapi.tidal.com/v2/tracks"
TRACK_URL = "https://tidal.com/browse/track/{id}"
# The tracks endpoint takes at most 20 ids in one filter.
_MAX_ARTIST_LOOKUP = 20
# The artist lookup must finish inside the search's own budget, with room to return.
_ARTIST_BUDGET = 0.9
_JSON_API = "application/vnd.api+json"


def adapter(token: TidalToken, backoff: Backoff) -> Adapter:
    """Bind the access token so the registry can call every adapter the same way.

    The search's tracks relationship cannot include artists, so a second request fetches
    the found tracks with their artists for the subtitle. When that request fails, the
    hits carry the title only.

    Args:
        token: The client-credentials token TIDAL requires on every catalog request.
        backoff: The shared rate-limit holds; a 429 on the artist lookup holds TIDAL here.

    Returns:
        Adapter: The TIDAL search.
    """

    async def search(
        query: str,
        country: str,
        client: httpx2.AsyncClient,
        timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
    ) -> AdapterAnswer:
        deadline = asyncio.get_running_loop().time() + timeout * _ARTIST_BUDGET
        with auth_errors(token):
            access = await token.get(client, timeout)
            headers = {"Authorization": f"Bearer {access}", "Accept": _JSON_API}

            async def fetch(country_code: str) -> object:
                return await get_json(
                    client,
                    SEARCH_URL,
                    params={
                        "filter[query]": query,
                        "countryCode": country_code,
                        "include": "tracks",
                    },
                    headers=headers,
                    timeout=timeout,
                )

            body, served = await with_region_fallback(country, fetch)
        tracks = {
            text(field(resource, "id")): field(resource, "attributes")
            for resource in items(field(body, "included"))
            if field(resource, "type") == "tracks"
        }
        # The search result's tracks relationship holds the matches in relevance order;
        # "included" holds their attributes in no promised order.
        ids = [
            track_id
            for ref in items(
                field(field(field(_search_result(body), "relationships"), "tracks"), "data")
            )
            if field(ref, "type") == "tracks"
            and (track_id := text(field(ref, "id"))) is not None
            and track_id in tracks
        ]
        artists = await _artist_names(
            ids[:_MAX_ARTIST_LOOKUP], served, client, headers, deadline, backoff
        )
        hits = collect(_hit(track_id, tracks, artists.get(track_id)) for track_id in ids)
        return AdapterAnswer(hits, served)

    return search


async def _artist_names(
    track_ids: list[str],
    country: str,
    client: httpx2.AsyncClient,
    headers: dict[str, str],
    deadline: float,
    backoff: Backoff,
) -> dict[str, str]:
    """Return each track's artist names by track id, or none when the lookup fails."""
    if not track_ids:
        return {}
    try:
        async with asyncio.timeout_at(deadline):
            body = await get_json(
                client,
                TRACKS_URL,
                params={"filter[id]": track_ids, "countryCode": country, "include": "artists"},
                headers=headers,
                timeout=max(deadline - asyncio.get_running_loop().time(), 0.0),
            )
    except httpx2.HTTPStatusError as error:
        seconds = backoff.hold_if_limited(Provider.TIDAL, error)
        if seconds is not None:
            log.warning("TIDAL artist lookup rate limited", extra={"seconds": seconds})
        else:
            log.warning("TIDAL artist lookup failed", extra={"error": type(error).__name__})
        return {}
    except (TimeoutError, httpx2.HTTPError, BlockedAddressError, ValueError) as error:
        # No traceback: its frames hold the bearer token, and the hits stand without artists.
        log.warning("TIDAL artist lookup failed", extra={"error": type(error).__name__})
        return {}
    names = {
        text(field(resource, "id")): text(field(field(resource, "attributes"), "name"))
        for resource in items(field(body, "included"))
        if field(resource, "type") == "artists"
    }
    found: dict[str, str] = {}
    for track in items(field(body, "data")):
        refs = items(field(field(field(track, "relationships"), "artists"), "data"))
        credited = [name for ref in refs if (name := names.get(text(field(ref, "id"))))]
        if (track_id := text(field(track, "id"))) and credited:
            found[track_id] = ", ".join(credited)
    return found


def _search_result(body: object) -> object:
    # JSON:API allows "data" as one resource or a list of them; TIDAL answers a list of one.
    data = field(body, "data")
    if isinstance(data, list):
        return next((item for item in data if field(item, "type") == "searchResults"), None)
    return data


def _hit(
    track_id: str | None, tracks: dict[str | None, object], artists: str | None
) -> SearchHit | None:
    if track_id is None or track_id not in tracks:
        return None
    attributes = tracks[track_id]
    title = text(field(attributes, "title"))
    version = text(field(attributes, "version"))
    return build_hit(
        TRACK_URL.format(id=quote(track_id, safe="")),
        provider="tidal",
        title=f"{title} ({version})" if title and version else title,
        subtitle=artists,
    )
