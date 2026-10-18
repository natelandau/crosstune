"""Place search for the web client's place picker."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import ServiceUnavailableError, TooManyRequestsError, problem_responses
from crosstune.places.maps import MapsBusyError, MapsError

_UNAVAILABLE = "Place search is not available"

router = APIRouter(prefix="/v1/places", tags=["places"])


class PlaceResult(BaseModel):
    """A place to pick: the name a recording stores, its coordinates, and how a list shows it.

    `title` is the list row's main line: a named place's own name, a street address, or a
    town. `subtitle` is the line under it that tells same-named results apart, the street and
    town of a named place or the town of an address, and is null for a town.
    """

    name: str
    lat: float
    lon: float
    title: str
    subtitle: str | None = None


class PlaceSearchResponse(BaseModel):
    """Places matching the search text, best match first."""

    results: list[PlaceResult]


@router.get("/search", responses=problem_responses(429, 503))
async def search_places(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    q: Annotated[str, Query(min_length=2, max_length=100)],
) -> PlaceSearchResponse:
    """Named places, street addresses, and towns for the text typed so far, each named as picked.

    Results lean toward the account's country, never toward the user's own location.
    """
    state = request.app.state
    if state.maps is None:
        raise ServiceUnavailableError(_UNAVAILABLE)
    # Charged in the handler rather than as a dependency so a malformed request never spends
    # the caller's limit.
    wait = state.place_search_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    # Read before the commit, which expires the loaded user.
    country = user.country
    # Resolving the caller opened a transaction on a pooled connection. Commit it so the
    # lookup, which can wait out its whole timeout, holds nothing from the pool.
    await session.commit()
    try:
        hits = await state.maps.search(
            state.http_client,
            q,
            country=country,
            timeout=state.settings.link_resolve_timeout_seconds,
        )
    except MapsBusyError as error:
        raise TooManyRequestsError(error.retry_after_seconds) from None
    except MapsError:
        # The error text can carry the query, so nothing is logged here.
        raise ServiceUnavailableError(_UNAVAILABLE) from None
    return PlaceSearchResponse(
        results=[
            PlaceResult(name=h.name, lat=h.lat, lon=h.lon, title=h.title, subtitle=h.subtitle)
            for h in hits
        ]
    )
