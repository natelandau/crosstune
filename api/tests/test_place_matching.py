"""Matching a recording's coordinates to a saved place."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from crosstune.db.base import new_uuid7, utc_now
from crosstune.models import Place, User
from crosstune.places.matching import (
    MATCH_MAX_ACCURACY_M,
    MATCH_RADIUS_M,
    distance_m,
    is_precise,
    matching_place_id,
)
from tests.test_jobs import make_user

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

LAT, LON = 40.7308, -74.0021
# One meter of latitude, in degrees.
M_LAT = 1 / 111_195


async def add_place(
    session: AsyncSession, user: User, lat: float, lon: float, *, deleted: bool = False
) -> Place:
    place = Place(
        id=new_uuid7(),
        user_id=user.id,
        name="Spot",
        lat=lat,
        lon=lon,
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now() if deleted else None,
    )
    session.add(place)
    await session.flush()
    return place


async def match(
    session: AsyncSession, user: User, lat: float = LAT, lon: float = LON, accuracy: int | None = 10
) -> uuid.UUID | None:
    return await matching_place_id(session, user_id=user.id, lat=lat, lon=lon, accuracy_m=accuracy)


def test_distance_across_the_antimeridian() -> None:
    assert distance_m(0, 179.9999, 0, -179.9999) == pytest.approx(22.2, abs=0.5)


def test_distance_at_high_latitude() -> None:
    # 0.001 degrees of longitude at 80 north is about 19.3 m, not 111 m.
    assert distance_m(80, 10, 80, 10.001) == pytest.approx(19.3, abs=0.5)


def test_precision() -> None:
    assert is_precise(None)
    assert is_precise(MATCH_MAX_ACCURACY_M)
    assert not is_precise(MATCH_MAX_ACCURACY_M + 1)


async def test_one_place_within_30_m_matches(session) -> None:
    user = await make_user(session)
    place = await add_place(session, user, LAT + 29 * M_LAT, LON)

    assert await match(session, user) == place.id


async def test_a_match_across_the_antimeridian(session) -> None:
    user = await make_user(session)
    place = await add_place(session, user, 0, -179.9999)

    assert await match(session, user, 0, 179.9999) == place.id
    assert await match(session, user, 0, -179.9999) == place.id


async def test_a_match_at_high_latitude(session) -> None:
    user = await make_user(session)
    place = await add_place(session, user, 80, 10.001)

    assert await match(session, user, 80, 10) == place.id
    assert await match(session, user, 80, 10.003) is None


async def test_two_places_within_30_m_match_neither(session) -> None:
    user = await make_user(session)
    await add_place(session, user, LAT + 5 * M_LAT, LON)
    await add_place(session, user, LAT - 5 * M_LAT, LON)

    assert await match(session, user) is None


async def test_place_31_m_away_does_not_match(session) -> None:
    user = await make_user(session)
    await add_place(session, user, LAT + (MATCH_RADIUS_M + 1) * M_LAT, LON)

    assert await match(session, user) is None


async def test_loose_fix_does_not_match(session) -> None:
    user = await make_user(session)
    await add_place(session, user, LAT, LON)

    assert await match(session, user, accuracy=MATCH_MAX_ACCURACY_M + 1) is None


async def test_file_location_matches(session) -> None:
    user = await make_user(session)
    place = await add_place(session, user, LAT, LON)

    assert await match(session, user, accuracy=None) == place.id


async def test_deleted_place_does_not_match(session) -> None:
    user = await make_user(session)
    await add_place(session, user, LAT, LON, deleted=True)

    assert await match(session, user) is None


async def test_another_users_place_does_not_match(session) -> None:
    user = await make_user(session)
    other = await make_user(session)
    await add_place(session, other, LAT, LON)

    assert await match(session, user) is None


async def test_a_match_near_the_pole(session) -> None:
    user = await make_user(session)
    # 25 m east at 89.9 north is about 0.13 degrees of longitude.
    place = await add_place(session, user, 89.9, 0.13)

    assert await match(session, user, 89.9, 0) == place.id


async def test_a_match_near_the_box_edge_at_lat_80(session) -> None:
    user = await make_user(session)
    # About 29 m east at 80 north.
    place = await add_place(session, user, 80, 29 / (111_195 * 0.173648))

    assert await match(session, user, 80, 0) == place.id
