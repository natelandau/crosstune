"""Place search for the web client's place picker."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import APIRouter, Query, Request
from pydantic import BaseModel

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.auth.tokens import party_allowed
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import (
    AppError,
    NotFoundError,
    ServiceUnavailableError,
    TooManyRequestsError,
    problem_responses,
)
from crosstune.places import mapkit
from crosstune.places.maps import MapsBusyError, MapsError
from crosstune.places.names import PlaceKind

_UNAVAILABLE = "Place search is not available"

_MAP_UNAVAILABLE = "Maps are not available"

_NO_PLACE = "No place at that point"

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
    lat: Annotated[float | None, Query(ge=-90, le=90)] = None,
    lon: Annotated[float | None, Query(ge=-180, le=180)] = None,
) -> PlaceSearchResponse:
    """Named places, street addresses, and towns for the text typed so far, each named as picked.

    Results lean toward the point given by `lat` and `lon`, which come together, else toward the
    account's country.
    """
    if (lat is None) != (lon is None):
        raise AppError(422, "Unprocessable Content", "lat and lon must be given together")
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
            near=None if lat is None or lon is None else (lat, lon),
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


class ReversePlaceResponse(BaseModel):
    """The place at a point: the name a recording stores, its address line, and the point."""

    name: str
    address: str | None
    lat: float
    lon: float


@router.get("/reverse", responses=problem_responses(404, 429, 503))
async def reverse_place(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
) -> ReversePlaceResponse:
    """Name a point as a street address with its town, and give its whole address."""
    state = request.app.state
    if state.maps is None:
        raise ServiceUnavailableError(_UNAVAILABLE)
    # Shares the place search limit: both spend the operator's Apple Maps quota.
    wait = state.place_search_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    # Read before the commit, which expires the loaded user.
    country = user.country
    # Resolving the caller opened a transaction on a pooled connection. Commit it so the
    # lookup, which can wait out its whole timeout, holds nothing from the pool.
    await session.commit()
    try:
        place = await state.maps.reverse_place(
            state.http_client,
            lat,
            lon,
            country=country,
            timeout=state.settings.link_resolve_timeout_seconds,
        )
    except MapsBusyError as error:
        raise TooManyRequestsError(error.retry_after_seconds) from None
    except MapsError:
        raise ServiceUnavailableError(_UNAVAILABLE) from None
    if place is None:
        raise NotFoundError(_NO_PLACE)
    return ReversePlaceResponse(
        name=place.name, address=place.address, lat=place.lat, lon=place.lon
    )


class MapKitTokenResponse(BaseModel):
    """A MapKit JS token for the web client's map, good only on the requesting web origin."""

    token: str
    expires_at: datetime


class SnapshotResponse(BaseModel):
    """A signed Apple Maps snapshot image URL."""

    url: str


def _well_formed_origin(value: str) -> bool:
    """True for `scheme://host[:port]` with an http or https scheme and nothing after."""
    try:
        parts = urlsplit(value)
        parts.port  # noqa: B018 -- raises ValueError on a malformed port
    except ValueError:
        return False
    return (
        parts.scheme in {"http", "https"}
        and bool(parts.hostname)
        and parts.username is None
        and f"{parts.scheme}://{parts.netloc}" == value
    )


def _token_origin(request: Request, requested: str | None) -> str:
    """The requested or header origin when it may sign in, else the configured web origin.

    Sign-in accepts any origin when no authorized party is configured, so this does too.
    """
    settings = request.app.state.settings
    origin = requested if requested is not None else request.headers.get("origin")
    if origin is not None and _well_formed_origin(origin):
        parties = settings.clerk_authorized_parties
        pattern = settings.clerk_authorized_party_regex
        if (
            origin == settings.web_origin
            or not (parties or pattern)
            or party_allowed(origin, parties, pattern)
        ):
            return origin
    return settings.web_origin


@router.get("/mapkit-token", responses=problem_responses(429, 503))
async def mapkit_token(
    request: Request,
    user: CurrentUser,
    origin: Annotated[str | None, Query(max_length=200)] = None,
) -> MapKitTokenResponse:
    """Issue a short-lived MapKit JS token restricted to the web client's origin.

    A browser sends no `Origin` header on a same-origin request, so the page passes its own
    origin as `origin`. An origin sign-in would not accept gets the configured web origin.
    """
    state = request.app.state
    if state.maps is None:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE)
    # A token's origin claim binds only a browser, so a script could spend the operator's
    # MapKit JS quota with every token it is handed.
    wait = state.mapkit_token_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    try:
        issued = mapkit.issue_token(state.maps, origin=_token_origin(request, origin))
    except MapsError:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE) from None
    return MapKitTokenResponse(token=issued.token, expires_at=issued.expires_at)


@router.get("/snapshot", responses=problem_responses(429, 503))
async def snapshot(  # noqa: PLR0913
    request: Request,
    user: CurrentUser,
    *,
    lat: Annotated[float, Query(ge=-90, le=90)],
    lon: Annotated[float, Query(ge=-180, le=180)],
    width: Annotated[int, Query(ge=mapkit.MIN_SNAPSHOT_SIDE, le=mapkit.MAX_SNAPSHOT_SIDE)],
    height: Annotated[int, Query(ge=mapkit.MIN_SNAPSHOT_SIDE, le=mapkit.MAX_SNAPSHOT_SIDE)],
    scheme: mapkit.Scheme,
    accuracy_m: Annotated[int | None, Query(ge=0)] = None,
) -> SnapshotResponse:
    """A signed snapshot URL with a pin at a precise point, or a circle of the fix's accuracy."""
    maps = request.app.state.maps
    if maps is None:
        raise ServiceUnavailableError(_MAP_UNAVAILABLE)
    # Each signed URL renders under the operator's snapshot quota, for anyone who holds it.
    wait = request.app.state.place_snapshot_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)
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
