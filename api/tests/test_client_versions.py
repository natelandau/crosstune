"""Each account's client version is recorded per platform, at most once an hour."""

import uuid
from datetime import UTC, datetime, timedelta

import anyio
import pytest
from sqlalchemy import delete, event, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.client_version import ClientVersion, client_version
from crosstune.client_versions import RecordedClientVersions, record_client_version
from crosstune.models import AccountClientVersion, User

IOS_120 = ClientVersion(platform="ios", version=(1, 2, 0))
IOS_130 = ClientVersion(platform="ios", version=(1, 3, 0))
MACOS_120 = ClientVersion(platform="macos", version=(1, 2, 0))
IOS_110 = ClientVersion(platform="ios", version=(1, 1, 0))


@pytest.fixture
def now() -> datetime:
    return datetime(2026, 10, 18, 12, 0, tzinfo=UTC)


def test_recorded_client_versions_due() -> None:
    uid = uuid.uuid4()
    t0 = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)
    s = RecordedClientVersions()
    assert s.due(uid, "ios", t0)
    s.seen(uid, "ios", t0)
    assert not s.due(uid, "ios", t0 + timedelta(minutes=59))
    assert s.due(uid, "ios", t0 + timedelta(minutes=61))
    assert s.due(uuid.uuid4(), "ios", t0)
    assert s.due(uid, "macos", t0)


def test_recorded_client_versions_keep_at_most_the_newest_pairs() -> None:
    t0 = datetime(2026, 10, 18, 12, 0, tzinfo=UTC)
    first, second = uuid.uuid4(), uuid.uuid4()
    s = RecordedClientVersions()
    s.seen(first, "ios", t0)
    s.seen(second, "ios", t0)
    # Seen again, so the second pair is now the oldest.
    s.seen(first, "ios", t0)
    for _ in range(9_999):
        s.seen(uuid.uuid4(), "ios", t0)
    assert s.due(second, "ios", t0)
    assert not s.due(first, "ios", t0)


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
            AccountClientVersion.platform,
            AccountClientVersion.version,
            AccountClientVersion.last_seen_at,
        ).order_by(AccountClientVersion.platform)
    )
    return [tuple(row) for row in result]


@pytest.mark.anyio
async def test_record_client_version_upserts_once_per_granularity(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    sessionmaker = app.state.sessionmaker
    recorded = RecordedClientVersions()

    await record_client_version(sessionmaker, recorded, user_id, IOS_120, now)
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]

    # Not due: the row keeps the first time.
    await record_client_version(
        sessionmaker, recorded, user_id, IOS_120, now + timedelta(minutes=10)
    )
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]

    later = now + timedelta(minutes=61)
    await record_client_version(sessionmaker, recorded, user_id, IOS_130, later)
    assert await _rows(verify_session) == [("ios", "1.3.0", later)]


@pytest.mark.anyio
@pytest.mark.parametrize("each_request_on_a_new_replica", [False, True])
@pytest.mark.parametrize(
    ("first", "second", "stored"),
    [("1.0", "1.0.0", ["1.0.0", "1.0.0"]), ("1.0", "1.1", ["1.0.0", "1.1.0"])],
    ids=["equal-texts", "different-versions"],
)
async def test_alternating_versions_write_once_an_hour(
    app,
    verify_session: AsyncSession,
    now: datetime,
    first: str,
    second: str,
    stored: list[str],
    *,
    each_request_on_a_new_replica: bool,
) -> None:
    user_id = await _make_user(verify_session)
    shared = RecordedClientVersions()
    texts = [first, second] * 6
    writes: list[int] = []

    def count(_conn, cursor, statement: str, *_args) -> None:
        if statement.lower().startswith("insert into client_versions"):
            writes.append(cursor.rowcount)

    async def record(text: str, at: datetime) -> None:
        recorded = RecordedClientVersions() if each_request_on_a_new_replica else shared
        version = client_version({"X-Client-Platform": "ios", "X-Client-Version": text})
        assert version is not None
        await record_client_version(app.state.sessionmaker, recorded, user_id, version, at)

    event.listen(app.state.engine.sync_engine, "after_cursor_execute", count)
    try:
        for minute, version_text in enumerate(texts):
            await record(version_text, now + timedelta(minutes=minute))
        assert sum(writes) == 1
        assert await _rows(verify_session) == [("ios", stored[0], now)]

        later = now + timedelta(minutes=61)
        await record(second, later)
    finally:
        event.remove(app.state.engine.sync_engine, "after_cursor_execute", count)
    assert sum(writes) == 2
    assert await _rows(verify_session) == [("ios", stored[1], later)]


@pytest.mark.anyio
async def test_record_client_version_skips_a_write_another_replica_just_made(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    sessionmaker = app.state.sessionmaker

    await record_client_version(sessionmaker, RecordedClientVersions(), user_id, IOS_120, now)
    # A second process has an empty memory, so it tries; the row's own guard declines.
    await record_client_version(
        sessionmaker, RecordedClientVersions(), user_id, IOS_120, now + timedelta(minutes=10)
    )
    assert await _rows(verify_session) == [("ios", "1.2.0", now)]


@pytest.mark.anyio
async def test_client_versions_keep_platforms_apart(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    recorded = RecordedClientVersions()
    await record_client_version(app.state.sessionmaker, recorded, user_id, MACOS_120, now)
    await record_client_version(app.state.sessionmaker, recorded, user_id, IOS_110, now)
    assert await _rows(verify_session) == [("ios", "1.1.0", now), ("macos", "1.2.0", now)]


@pytest.mark.anyio
async def test_client_versions_go_with_the_account(
    app, verify_session: AsyncSession, now: datetime
) -> None:
    user_id = await _make_user(verify_session)
    await record_client_version(
        app.state.sessionmaker, RecordedClientVersions(), user_id, IOS_120, now
    )
    await verify_session.execute(delete(User).where(User.id == user_id))
    await verify_session.commit()
    assert await _rows(verify_session) == []


@pytest.mark.anyio
async def test_record_client_version_swallows_a_database_error(app, now: datetime) -> None:
    recorded = RecordedClientVersions()
    # No such user: the foreign key rejects the insert, so the pair stays due.
    user_id = uuid.uuid4()
    await record_client_version(app.state.sessionmaker, recorded, user_id, IOS_120, now)
    assert recorded.due(user_id, "ios", now)


@pytest.mark.anyio
async def test_record_client_version_gives_up_behind_a_locked_account(
    app, verify_session: AsyncSession, now: datetime, caplog: pytest.LogCaptureFixture
) -> None:
    user_id = await _make_user(verify_session)
    recorded = RecordedClientVersions()
    # A sync holds the account row like this through its commit.
    await verify_session.execute(
        text("select id from users where id = :id for update"), {"id": user_id}
    )
    with anyio.fail_after(5):
        await record_client_version(app.state.sessionmaker, recorded, user_id, IOS_120, now)
    await verify_session.rollback()
    assert recorded.due(user_id, "ios", now)
    assert await _rows(verify_session) == []
    assert [
        r for r in caplog.records if r.name == "crosstune.client_versions" and r.levelno >= 30
    ] == []
