"""Place search for the web client's place picker."""

from __future__ import annotations

from datetime import datetime
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
from crosstune.places import mapkit
from crosstune.places.maps import MapsBusyError, MapsError
from crosstune.places.names import PlaceKind

_UNAVAILABLE = "Place search is not available"

_MAP_UNAVAILABLE = "Maps are not available"

router = APIRouter(prefix="/v1/places", tags=["places"])


class PlaceResult(BaseModel):
    """A place to pick: the name a recording stores, its coordinates, and how a list shows it.

    `title` is the list row's main line: a named place's own name, a street address, or a
    town. `subtitle` is the line under it that tells same-named results apart, the street and
    town of a named place or the town of an address, and is null for a town. `kind` says which
    of the three it is, so a client saves a venue or an address as a location and not a town;
    `address` is a venue's `street, town` line, null for an address or a town.
    """

    name: str
    lat: float
    lon: float
    title: str
    subtitle: str | None = None
    kind: PlaceKind
    address: str | None = None


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
            PlaceResult(
                name=h.name,
                lat=h.lat,
                lon=h.lon,
                title=h.title,
                subtitle=h.subtitle,
                kind=h.kind,
                address=h.address,
            )
            for h in hits
        ]
    )


class MapKitTokenResponse(BaseModel):
    """A MapKit JS token for the web client's map, good only on the web origin."""

    token: str
    expires_at: datetime


class SnapshotResponse(BaseModel):
    """A signed Apple Maps snapshot image URL."""

    url: str


@router.get("/mapkit-token", responses=problem_responses(503))
async def mapkit_token(request: Request, user: CurrentUser) -> MapKitTokenResponse:  # noqa: ARG001
    """Issue a short-lived MapKit JS token restricted to the web origin."""
    state = request.app.state
    if state.maps is None:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE)
    try:
        issued = mapkit.issue_token(state.maps, origin=state.settings.web_origin)
    except MapsError:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE) from None
    return MapKitTokenResponse(token=issued.token, expires_at=issued.expires_at)


@router.get("/snapshot", responses=problem_responses(503))
async def snapshot(  # noqa: PLR0913
    request: Request,
    user: CurrentUser,  # noqa: ARG001
    *,
    lat: Annotated[float, Query(gt=-90, lt=90)],
    lon: Annotated[float, Query(gt=-180, lt=180)],
    width: Annotated[int, Query(ge=mapkit.MIN_SNAPSHOT_SIDE, le=mapkit.MAX_SNAPSHOT_SIDE)],
    height: Annotated[int, Query(ge=mapkit.MIN_SNAPSHOT_SIDE, le=mapkit.MAX_SNAPSHOT_SIDE)],
    scheme: mapkit.Scheme,
    accuracy_m: Annotated[int | None, Query(ge=0)] = None,
) -> SnapshotResponse:
    """A signed snapshot URL with a pin at a precise point, or a circle of the fix's accuracy."""
    maps = request.app.state.maps
    if maps is None:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE)
    try:
        url = mapkit.snapshot_url(
            maps,
            lat=lat,
            lon=lon,
            accuracy_m=accuracy_m,
            width=width,
            height=height,
            scheme=scheme,
        )
    except MapsError:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE) from None
    return SnapshotResponse(url=url)
