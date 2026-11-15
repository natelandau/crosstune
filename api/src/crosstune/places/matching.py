"""Link a recording's coordinates to a saved place."""

from __future__ import annotations

import math
from bisect import bisect_left, bisect_right
from collections import defaultdict
from dataclasses import dataclass
from operator import attrgetter
from typing import TYPE_CHECKING

from sqlalchemy import and_, case, func, literal, or_, select, union_all, update

from crosstune.db.base import bump_server_seq, next_server_seq
from crosstune.models import Place, Recording
from crosstune.vocabulary import PlaceOrigin

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable, Iterator, Sequence

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

MATCH_RADIUS_M = 30
MATCH_MAX_ACCURACY_M = 50
# The most live places one changed point's neighborhood may hold before the server stops
# linking recordings there on its own. Bounds the work of a push over a dense cluster.
MAX_PLACES_PER_AREA = 32
# The most unlinked recordings one changed point's neighborhood may hold before the server
# stops linking them there on its own. Bounds the rows a push reads and plans per point.
MAX_RECORDINGS_PER_AREA = 2_000
# asyncpg takes at most 32,767 bind parameters per statement, and each link takes three.
_LINKS_PER_UPDATE = 5_000

EARTH_RADIUS_M = 6_371_000
# Meters per degree of latitude, rounded down so the prefilter box is never too small.
_M_PER_DEGREE = 110_000
_POLE = 90.0
_LON_MAX = 180
# Degrees of latitude the match box reaches each side of a point.
_MATCH_DLAT = MATCH_RADIUS_M / _M_PER_DEGREE
_EVERY_LONGITUDE = ((-math.inf, math.inf),)
# Postgres allows at most 1,664 columns in a select list.
_COUNTS_PER_SELECT = 1_000
_lon = attrgetter("lon")


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


def _longitude_spans(lat: float, lon: float, dlat: float) -> tuple[tuple[float, float], ...]:
    """The longitude spans of a box reaching `dlat` degrees each side of a point.

    The box holds every point as near as its latitude edge. A box that crosses the
    antimeridian is two spans, each open at the edge it crosses.

    Returns:
        tuple[tuple[float, float], ...]: Each span's low and high longitude, `_EVERY_LONGITUDE`
            for a box that spans them all.
    """
    poleward = abs(lat) + dlat
    # Meridians converge at the pole, so a box that reaches it spans every longitude.
    if poleward >= _POLE:
        return _EVERY_LONGITUDE
    dlon = dlat / math.cos(math.radians(poleward))
    if dlon >= _LON_MAX:
        return _EVERY_LONGITUDE
    low, high = lon - dlon, lon + dlon
    if low < -_LON_MAX:
        return ((low + 2 * _LON_MAX, math.inf), (-math.inf, high))
    if high > _LON_MAX:
        return ((low, math.inf), (-math.inf, high - 2 * _LON_MAX))
    return ((low, high),)


def _span_clause(
    lon_column: InstrumentedAttribute[float | None], low: float, high: float
) -> ColumnElement[bool]:
    if low == -math.inf:
        return lon_column <= high
    if high == math.inf:
        return lon_column >= low
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
    spans = _longitude_spans(lat, lon, dlat)
    if spans != _EVERY_LONGITUDE:
        clauses.append(or_(*(_span_clause(lon_column, low, high) for low, high in spans)))
    return clauses


async def matching_place_id(
    session: AsyncSession, *, user_id: uuid.UUID, lat: float, lon: float, accuracy_m: int | None
) -> uuid.UUID | None:
    """Find the one live saved place within the match radius of a point.

    Returns:
        uuid.UUID | None: The place's id, or None when the fix is too loose, when no place
            or more than one place lies within the radius, or when the match box holds more
            than `MAX_PLACES_PER_AREA` places.
    """
    if not is_precise(accuracy_m):
        return None
    clauses = [
        Place.user_id == user_id,
        Place.deleted_at.is_(None),
        *_box_clauses(Place.lat, Place.lon, lat, lon),
    ]
    rows = (
        await session.execute(
            select(Place.id, Place.lat, Place.lon).where(*clauses).limit(MAX_PLACES_PER_AREA + 1)
        )
    ).all()
    # A full box cannot tell a match from an ambiguity, the same as a full area.
    if len(rows) > MAX_PLACES_PER_AREA:
        return None
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


def _grid_row(lat: float) -> int:
    return math.floor(lat / _MATCH_DLAT)


def _location_grid(locations: Iterable[Spot]) -> dict[int, list[Spot]]:
    """Saved locations in rows one match box tall, each row sorted by longitude.

    Lets `_near` find the locations in a point's match box without scanning every location
    at its latitude, so a crowded latitude costs no more than a crowded box.
    """
    grid: dict[int, list[Spot]] = defaultdict(list)
    for location in locations:
        grid[_grid_row(location.lat)].append(location)
    for row in grid.values():
        row.sort(key=_lon)
    return grid


def _near(grid: dict[int, list[Spot]], lat: float, lon: float) -> Iterator[Spot]:
    """Yield every saved location of a `_location_grid` in the match box of a point, each once."""
    spans = _longitude_spans(lat, lon, _MATCH_DLAT)
    middle = _grid_row(lat)
    # A row is as tall as the box reaches each side, so the box lies in these three rows.
    for key in (middle - 1, middle, middle + 1):
        row = grid.get(key, [])
        for low, high in spans:
            for index in range(bisect_left(row, low, key=_lon), bisect_right(row, high, key=_lon)):
                if abs(row[index].lat - lat) <= _MATCH_DLAT:
                    yield row[index]


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
        recordings: The unlinked recordings with a precise fix within the `recording_radius_m`
            of any area that is not full.

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
    grid = _location_grid(places.values())
    links: dict[uuid.UUID, uuid.UUID] = {}
    for recording in recordings:
        place_id = _sole_place_id(
            lat=recording.lat, lon=recording.lon, places=_near(grid, recording.lat, recording.lon)
        )
        if place_id is not None and place_id in candidates:
            links[recording.id] = place_id
    return links


async def link_earlier_recordings(
    session: AsyncSession, *, user_id: uuid.UUID, areas: Iterable[Area]
) -> int:
    """Link the user's unlinked device and file recordings that now match one place near an area.

    Runs a fixed number of queries, plus one count per `_COUNTS_PER_SELECT` areas and one
    update per `_LINKS_PER_UPDATE` links. Skips an area that holds more than
    `MAX_PLACES_PER_AREA` places or more than `MAX_RECORDINGS_PER_AREA` unlinked recordings
    with a precise fix. Takes the same server_seq bump as any server write and leaves
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
    # Every saved location within one radius of a recording lies in the box of each area that
    # reaches it, so leaving out a full area's places never turns an ambiguity into a match.
    open_areas = [
        (area, near)
        for area, near in zip(unique, places_by_area, strict=True)
        if len(near) <= MAX_PLACES_PER_AREA
    ]
    if not open_areas:
        return 0
    unlinked = (
        Recording.user_id == user_id,
        Recording.deleted_at.is_(None),
        Recording.place_id.is_(None),
        Recording.place_origin.in_((PlaceOrigin.DEVICE.value, PlaceOrigin.FILE.value)),
        # Matches is_precise, so a loose fix that can never link does not fill an area.
        or_(
            Recording.place_accuracy_m.is_(None),
            Recording.place_accuracy_m <= MATCH_MAX_ACCURACY_M,
        ),
    )
    boxes = [
        and_(
            *_box_clauses(
                Recording.place_lat,
                Recording.place_lon,
                area.lat,
                area.lon,
                radius_m=area.recording_radius_m,
            )
        )
        for area, _ in open_areas
    ]
    counts: list[int] = []
    for start in range(0, len(boxes), _COUNTS_PER_SELECT):
        chunk = boxes[start : start + _COUNTS_PER_SELECT]
        counts.extend(
            (
                await session.execute(
                    select(*(func.count().filter(box) for box in chunk)).where(
                        *unlinked, or_(*chunk)
                    )
                )
            ).one()
        )
    kept = [
        (area, near, box)
        for (area, near), box, count in zip(open_areas, boxes, counts, strict=True)
        if count <= MAX_RECORDINGS_PER_AREA
    ]
    if not kept:
        return 0
    kept_areas, kept_places, kept_boxes = zip(*kept, strict=True)
    rows = await session.execute(
        select(Recording.id, Recording.place_lat, Recording.place_lon).where(
            *unlinked, or_(*kept_boxes)
        )
    )
    recordings = [
        Spot(id=recording_id, lat=lat, lon=lon)
        for recording_id, lat, lon in rows
        if lat is not None and lon is not None
    ]
    links = plan_links(areas=kept_areas, places_by_area=kept_places, recordings=recordings)
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
