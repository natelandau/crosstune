"""Link a recording's coordinates to a saved place."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from dataclasses import dataclass
from operator import attrgetter
from typing import TYPE_CHECKING

from sqlalchemy import and_, case, literal, or_, select, union_all, update

from crosstune.db.base import bump_server_seq, next_server_seq
from crosstune.models import Place, Recording
from crosstune.vocabulary import PlaceOrigin

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable, Sequence

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

MATCH_RADIUS_M = 30
MATCH_MAX_ACCURACY_M = 50
# The most live places one changed point's neighborhood may hold before the server stops
# linking recordings there on its own. Bounds the work of a push over a dense cluster.
MAX_PLACES_PER_AREA = 32
# asyncpg takes at most 32,767 bind parameters per statement, and each link takes three.
_LINKS_PER_UPDATE = 5_000

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
    return _sole_place_id(
        lat=lat, lon=lon, places=(Spot(id=pid, lat=plat, lon=plon) for pid, plat, plon in rows)
    )


# The point types below have no repr, so an error report never prints a point.
@dataclass(frozen=True, slots=True, repr=False)
class Spot:
    """A saved place's or a recording's id and point."""

    id: uuid.UUID
    lat: float
    lon: float


def _sole_place_id(lat: float, lon: float, places: Iterable[Spot]) -> uuid.UUID | None:
    """The one place within the match radius of a point, or None when none or several are."""
    near: uuid.UUID | None = None
    for place in places:
        if distance_m(lat, lon, place.lat, place.lon) <= MATCH_RADIUS_M:
            if near is not None:
                return None
            near = place.id
    return near


@dataclass(frozen=True, slots=True, repr=False)
class Area:
    """A point a push changed: where a live place now stands, or where a place stood before.

    A recording near a place that now stands here may now match it. A recording that matched
    both a departed place and a neighbor matched neither, so the neighbors within two radii
    of a point a place left are the places such a recording may now match.
    """

    lat: float
    lon: float
    # The live place that stands here now, or None for a point a place left.
    place_id: uuid.UUID | None = None

    @property
    def place_radius_m(self) -> float:
        """The reach that holds every place within one radius of any recording this area links."""
        return (2 if self.place_id is not None else 4) * MATCH_RADIUS_M

    @property
    def recording_radius_m(self) -> float:
        """The reach that holds every recording this area can link."""
        return (1 if self.place_id is not None else 3) * MATCH_RADIUS_M


def plan_links(
    areas: Sequence[Area], places_by_area: Sequence[Sequence[Spot]], recordings: Iterable[Spot]
) -> dict[uuid.UUID, uuid.UUID]:
    """Decide which unlinked recordings now match exactly one live place near a changed point.

    Args:
        areas: The points a push changed.
        places_by_area: For each area, the live places within its `place_radius_m` box, cut
            off past `MAX_PLACES_PER_AREA`.
        recordings: The unlinked recordings with a precise fix within any area's
            `recording_radius_m`.

    Returns:
        dict[uuid.UUID, uuid.UUID]: Each recording to link, mapped to its place.
    """
    candidates: set[uuid.UUID] = set()
    places: dict[uuid.UUID, Spot] = {}
    for area, near in zip(areas, places_by_area, strict=True):
        # Every place within one radius of a recording that a candidate here matches lies in
        # this area's box, so a full area cannot tell a match from an ambiguity.
        if len(near) > MAX_PLACES_PER_AREA:
            continue
        places.update((place.id, place) for place in near)
        if area.place_id is not None:
            if any(place.id == area.place_id for place in near):
                candidates.add(area.place_id)
        else:
            candidates.update(
                place.id
                for place in near
                if distance_m(area.lat, area.lon, place.lat, place.lon) <= 2 * MATCH_RADIUS_M
            )
    lat = attrgetter("lat")
    by_lat = sorted(places.values(), key=lat)
    dlat = MATCH_RADIUS_M / _M_PER_DEGREE
    links: dict[uuid.UUID, uuid.UUID] = {}
    for recording in recordings:
        low = bisect_left(by_lat, recording.lat - dlat, key=lat)
        high = bisect_right(by_lat, recording.lat + dlat, key=lat)
        place_id = _sole_place_id(lat=recording.lat, lon=recording.lon, places=by_lat[low:high])
        if place_id is not None and place_id in candidates:
            links[recording.id] = place_id
    return links


async def link_earlier_recordings(
    session: AsyncSession, *, user_id: uuid.UUID, areas: Iterable[Area]
) -> int:
    """Link the user's unlinked device and file recordings that now match one place near an area.

    Runs a fixed number of queries for any number of areas, plus one update per
    `_LINKS_PER_UPDATE` links. Takes the same server_seq bump as any server write and leaves
    `updated_at` alone.

    Returns:
        int: How many recordings were linked.
    """
    unique = list(dict.fromkeys(areas))
    if not unique:
        return 0
    place_rows = await session.execute(
        union_all(
            *(
                select(literal(index).label("area"), Place.id, Place.lat, Place.lon)
                .where(
                    Place.user_id == user_id,
                    Place.deleted_at.is_(None),
                    *_box_clauses(
                        Place.lat, Place.lon, area.lat, area.lon, radius_m=area.place_radius_m
                    ),
                )
                .limit(MAX_PLACES_PER_AREA + 1)
                for index, area in enumerate(unique)
            )
        )
    )
    places_by_area: list[list[Spot]] = [[] for _ in unique]
    for index, place_id, lat, lon in place_rows:
        places_by_area[index].append(Spot(id=place_id, lat=lat, lon=lon))
    # plan_links skips a full area, so no recording only it reaches can link.
    open_areas = [
        area
        for area, near in zip(unique, places_by_area, strict=True)
        if len(near) <= MAX_PLACES_PER_AREA
    ]
    if not open_areas:
        return 0
    rows = await session.execute(
        select(
            Recording.id, Recording.place_lat, Recording.place_lon, Recording.place_accuracy_m
        ).where(
            Recording.user_id == user_id,
            Recording.deleted_at.is_(None),
            Recording.place_id.is_(None),
            Recording.place_origin.in_((PlaceOrigin.DEVICE.value, PlaceOrigin.FILE.value)),
            or_(
                *(
                    and_(
                        *_box_clauses(
                            Recording.place_lat,
                            Recording.place_lon,
                            area.lat,
                            area.lon,
                            radius_m=area.recording_radius_m,
                        )
                    )
                    for area in open_areas
                )
            ),
        )
    )
    recordings = [
        Spot(id=recording_id, lat=lat, lon=lon)
        for recording_id, lat, lon, accuracy_m in rows
        if lat is not None and lon is not None and is_precise(accuracy_m)
    ]
    links = plan_links(areas=unique, places_by_area=places_by_area, recordings=recordings)
    pending = list(links.items())
    for start in range(0, len(pending), _LINKS_PER_UPDATE):
        chunk = dict(pending[start : start + _LINKS_PER_UPDATE])
        await session.execute(
            update(Recording)
            .where(Recording.id.in_(list(chunk)), Recording.user_id == user_id)
            .values(
                place_id=case(
                    {
                        recording_id: literal(place_id, Recording.place_id.type)
                        for recording_id, place_id in chunk.items()
                    },
                    value=Recording.id,
                ),
                server_seq=next_server_seq(),
            )
            .returning(Recording),
            # populate_existing, so a copy of the row already in the session takes the write.
            execution_options={"populate_existing": True},
        )
    return len(links)


async def unlink_place(session: AsyncSession, *, user_id: uuid.UUID, place_id: uuid.UUID) -> int:
    """Clear the link of every recording of the user filed under a place, keeping their own names.

    Returns:
        int: How many recordings were unlinked.
    """
    rows = await session.scalars(
        select(Recording).where(Recording.user_id == user_id, Recording.place_id == place_id)
    )
    unlinked = rows.all()
    for recording in unlinked:
        recording.place_id = None
        bump_server_seq(recording)
    await session.flush()
    return len(unlinked)
