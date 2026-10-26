"""Link a recording's coordinates to a saved place."""

from __future__ import annotations

import math
from typing import TYPE_CHECKING

from sqlalchemy import and_, or_, select

from crosstune.db.base import bump_server_seq
from crosstune.models import Place, Recording
from crosstune.vocabulary import PlaceOrigin

if TYPE_CHECKING:
    import uuid

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

MATCH_RADIUS_M = 30
MATCH_MAX_ACCURACY_M = 50

EARTH_RADIUS_M = 6_371_000
# Meters per degree of latitude, rounded down so the prefilter box is never too small.
_M_PER_DEGREE = 110_000
_POLE = 90.0
_LON_MAX = 180


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in meters between two points (haversine)."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = phi2 - phi1
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(min(1.0, math.sqrt(a)))


def is_precise(accuracy_m: int | None) -> bool:
    """Whether a fix is tight enough to match a saved place.

    A missing accuracy (a location read from a file) counts as precise.
    """
    return accuracy_m is None or accuracy_m <= MATCH_MAX_ACCURACY_M


def _longitude_filter(
    lon_column: InstrumentedAttribute[float | None], lon: float, dlon: float
) -> ColumnElement[bool] | None:
    if dlon >= _LON_MAX:  # the box spans every longitude
        return None
    low, high = lon - dlon, lon + dlon
    if low < -_LON_MAX:
        return or_(lon_column >= low + 2 * _LON_MAX, lon_column <= high)
    if high > _LON_MAX:
        return or_(lon_column >= low, lon_column <= high - 2 * _LON_MAX)
    return and_(lon_column >= low, lon_column <= high)


def _box_clauses(
    lat_column: InstrumentedAttribute[float | None],
    lon_column: InstrumentedAttribute[float | None],
    lat: float,
    lon: float,
    radius_m: float = MATCH_RADIUS_M,
) -> list[ColumnElement[bool]]:
    """Clauses for a box that holds every point within `radius_m` of a point."""
    dlat = radius_m / _M_PER_DEGREE
    clauses = [lat_column.between(lat - dlat, lat + dlat)]
    poleward = abs(lat) + dlat
    # Meridians converge at the pole, so a box that reaches it spans every longitude.
    if poleward < _POLE:
        lon_clause = _longitude_filter(lon_column, lon, dlat / math.cos(math.radians(poleward)))
        if lon_clause is not None:
            clauses.append(lon_clause)
    return clauses


async def matching_place_id(
    session: AsyncSession, *, user_id: uuid.UUID, lat: float, lon: float, accuracy_m: int | None
) -> uuid.UUID | None:
    """Find the one live saved place within the match radius of a point.

    Returns:
        uuid.UUID | None: The place's id, or None when the fix is too loose or no place
            or more than one place lies within the radius.
    """
    if not is_precise(accuracy_m):
        return None
    clauses = [
        Place.user_id == user_id,
        Place.deleted_at.is_(None),
        *_box_clauses(Place.lat, Place.lon, lat, lon),
    ]
    rows = await session.execute(select(Place.id, Place.lat, Place.lon).where(*clauses))
    near = [
        place_id
        for place_id, place_lat, place_lon in rows
        if distance_m(lat, lon, place_lat, place_lon) <= MATCH_RADIUS_M
    ]
    return near[0] if len(near) == 1 else None


async def link_earlier_recordings(session: AsyncSession, place: Place) -> int:
    """Link the user's unlinked device and file recordings whose only saved place is this one.

    Takes the same server_seq bump as any server write and leaves `updated_at` alone.

    Returns:
        int: How many recordings were linked.
    """
    rows = await session.scalars(
        select(Recording).where(
            Recording.user_id == place.user_id,
            Recording.deleted_at.is_(None),
            Recording.place_id.is_(None),
            Recording.place_origin.in_((PlaceOrigin.DEVICE.value, PlaceOrigin.FILE.value)),
            *_box_clauses(Recording.place_lat, Recording.place_lon, place.lat, place.lon),
        )
    )
    recordings = rows.all()
    if not recordings:
        return 0
    # A recording this place matches lies within one radius of it, so every other place that
    # recording matches lies within two, and one read of them serves every recording.
    neighbors = (
        await session.execute(
            select(Place.id, Place.lat, Place.lon).where(
                Place.user_id == place.user_id,
                Place.deleted_at.is_(None),
                *_box_clauses(
                    Place.lat, Place.lon, place.lat, place.lon, radius_m=2 * MATCH_RADIUS_M
                ),
            )
        )
    ).all()
    linked = 0
    for recording in recordings:
        lat, lon = recording.place_lat, recording.place_lon
        if lat is None or lon is None or not is_precise(recording.place_accuracy_m):
            continue
        near = [
            place_id
            for place_id, place_lat, place_lon in neighbors
            if distance_m(lat, lon, place_lat, place_lon) <= MATCH_RADIUS_M
        ]
        if near == [place.id]:
            recording.place_id = place.id
            bump_server_seq(recording)
            linked += 1
    await session.flush()
    return linked


async def rematch_neighbor_places(
    session: AsyncSession, *, user_id: uuid.UUID, lat: float, lon: float
) -> int:
    """Link earlier recordings to each live place that shares them with a point's match radius.

    A recording matches no place while two lie within its radius, so removing a place at this
    point can leave a neighbor as some recording's only match. Such a neighbor lies within two
    match radii of the point.

    Returns:
        int: How many recordings were linked.
    """
    rows = await session.scalars(
        select(Place).where(
            Place.user_id == user_id,
            Place.deleted_at.is_(None),
            *_box_clauses(Place.lat, Place.lon, lat, lon, radius_m=2 * MATCH_RADIUS_M),
        )
    )
    linked = 0
    for place in rows.all():
        if distance_m(lat, lon, place.lat, place.lon) <= 2 * MATCH_RADIUS_M:
            linked += await link_earlier_recordings(session, place)
    return linked


async def unlink_place(session: AsyncSession, place_id: uuid.UUID) -> int:
    """Clear the link of every recording filed under a place, keeping their own names.

    Returns:
        int: How many recordings were unlinked.
    """
    rows = await session.scalars(select(Recording).where(Recording.place_id == place_id))
    unlinked = rows.all()
    for recording in unlinked:
        recording.place_id = None
        bump_server_seq(recording)
    await session.flush()
    return len(unlinked)
