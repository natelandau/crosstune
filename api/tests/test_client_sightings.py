"""Each account's client version is recorded per platform, at most once an hour."""

import uuid
from datetime import UTC, datetime, timedelta

import anyio
import pytest
from sqlalchemy import delete, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.client_sightings import ClientSightings, record_sighting
from crosstune.client_version import ClientVersion
from crosstune.models import ClientVersionSighting, User

IOS_120 = ClientVersion("ios", "1.2.0", (1, 2, 0))
IOS_130 = ClientVersion("ios", "1.3.0", (1, 3, 0))
MACOS_120 = ClientVersion("macos", "1.2.0", (1, 2, 0))
IOS_110 = ClientVersion("ios", "1.1.0", (1, 1, 0))


@pytest.fixture
def now() -> datetime:
    return datetime(2026, 10, 18, 12, 0, tzinfo=UTC)


def test_client_sightings_due() -> None:
    uid = uuid.uuid4()
    t0 = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)
    s = ClientSightings()
    assert s.due(uid, IOS_120, t0)
    s.seen(uid, IOS_120, t0)
    assert not s.due(uid, IOS_120, t0 + timedelta(minutes=59))
    assert s.due(uid, IOS_130, t0 + timedelta(minutes=1))
    assert s.due(uid, IOS_120, t0 + timedelta(minutes=61))
    assert s.due(uuid.uuid4(), IOS_120, t0)
    assert s.due(uid, MACOS_120, t0)


def test_client_sightings_keep_at_most_the_newest_pairs() -> None:
    t0 = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)
    first, second = uuid.uuid4(), uuid.uuid4()
    s = ClientSightings()
    s.seen(first, IOS_120, t0)
    s.seen(second, IOS_120, t0)
    # Seen again, so the second pair is now the oldest.
    s.seen(first, IOS_120, t0)
    for _ in range(9_999):
        s.seen(uuid.uuid4(), IOS_120, t0)
    assert s.due(second, IOS_120, t0)
    assert not s.due(first, IOS_120, t0)


async def _make_user(session: AsyncSession) -> uuid.UUID:
    user_id = uuid.uuid4()
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values (:id, :clerk, now(), now())"
        ),
        {"id": user_id, "clerk": f"user_{user_id}"},
    )
    await session.commit()
    return user_id


async def _rows(session: AsyncSession) -> list[tuple[str, str, datetime]]:
    session.expire_all()
    result = await session.execute(
        select(
            ClientVersionSighting.platform,
            ClientVersionSighting.version,
            ClientVersionSighting.last_seen_at,
        ).order_by(ClientVersionSighting.platform)
    )
    return [tuple(row) for row in result]


@pytest.mark.anyio
async def test_record_sighting_upserts_once_per_granularity(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    sessionmaker = app.state.sessionmaker
    sightings = ClientSightings()

    await record_sighting(sessionmaker, sightings, user_id, IOS_120, now)
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]

    # Not due: the row keeps the first time.
    await record_sighting(sessionmaker, sightings, user_id, IOS_120, now + timedelta(minutes=10))
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]

    later = now + timedelta(minutes=11)
    await record_sighting(sessionmaker, sightings, user_id, IOS_130, later)
    assert await _rows(verify_session) == [("ios", "1.3.0", later)]


@pytest.mark.anyio
async def test_record_sighting_skips_a_write_another_replica_just_made(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    sessionmaker = app.state.sessionmaker

    await record_sighting(sessionmaker, ClientSightings(), user_id, IOS_120, now)
    # A second process has an empty memory, so it tries; the row's own guard declines.
    await record_sighting(
        sessionmaker, ClientSightings(), user_id, IOS_120, now + timedelta(minutes=10)
    )
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]


@pytest.mark.anyio
async def test_sightings_keep_platforms_apart(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    sightings = ClientSightings()
    await record_sighting(app.state.sessionmaker, sightings, user_id, MACOS_120, now)
    await record_sighting(app.state.sessionmaker, sightings, user_id, IOS_110, now)
    assert await _rows(verify_session) == [("ios", "1.1.0", now), ("macos", "1.2.0", now)]


@pytest.mark.anyio
async def test_sightings_go_with_the_account(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    await record_sighting(app.state.sessionmaker, ClientSightings(), user_id, IOS_120, now)
    await verify_session.execute(delete(User).where(User.id == user_id))
    await verify_session.commit()
    assert await _rows(verify_session) == []


@pytest.mark.anyio
async def test_record_sighting_swallows_a_database_error(app, now: datetime) -> None:
    sightings = ClientSightings()
    # No such user: the foreign key rejects the insert, so the pair stays due.
    user_id = uuid.uuid4()
    await record_sighting(app.state.sessionmaker, sightings, user_id, IOS_120, now)
    assert sightings.due(user_id, IOS_120, now)


@pytest.mark.anyio
async def test_record_sighting_gives_up_behind_a_locked_account(
    app, verify_session: AsyncSession, now: datetime, caplog: pytest.LogCaptureFixture
) -> None:
    user_id = await _make_user(verify_session)
    sightings = ClientSightings()
    # A sync holds the account row like this through its commit.
    await verify_session.execute(
        text("select id from users where id = :id for update"), {"id": user_id}
    )
    with anyio.fail_after(5):
        await record_sighting(app.state.sessionmaker, sightings, user_id, IOS_120, now)
    await verify_session.rollback()
    assert sightings.due(user_id, IOS_120, now)
    assert await _rows(verify_session) == []
    assert [
        r for r in caplog.records if r.name == "crosstune.client_sightings" and r.levelno >= 30
    ] == []
