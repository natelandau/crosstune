"""Daily Apple Maps budgets, per account and for the whole team, kept in Postgres."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta
from typing import TYPE_CHECKING

import anyio
import pytest
from sqlalchemy import select

from crosstune.db.engine import make_sessionmaker
from crosstune.models import MapsUsage
from crosstune.places.budget import KEPT_DAYS, DailyLimits, SpentBy, charge, prune
from crosstune.vocabulary import MapsUsageKind
from tests.test_jobs import make_user

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.anyio

# Late in a UTC day, so a test can step past midnight.
LATE = datetime(2026, 11, 14, 23, 59, 30, tzinfo=UTC)
MIDNIGHT = datetime(2026, 11, 15, tzinfo=UTC)
KINDS = pytest.mark.parametrize("kind", list(MapsUsageKind))


async def _charge(
    sessionmaker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID | None,
    kind: MapsUsageKind,
    limits: DailyLimits,
    now: datetime = LATE,
) -> SpentBy | None:
    async with sessionmaker() as session, session.begin():
        spent = await charge(session, user_id=user_id, kind=kind, limits=limits, now=now)
    if spent is None:
        return None
    # A spent budget opens again at the next UTC midnight.
    assert now < spent.resets_at <= now + timedelta(days=1)
    assert spent.resets_at.timetz() == time(tzinfo=UTC)
    return spent.by


async def _users(session: AsyncSession, count: int) -> list[uuid.UUID]:
    users = [(await make_user(session)).id for _ in range(count)]
    await session.commit()
    return users


@KINDS
async def test_the_account_limit_refuses_the_next_charge(
    engine, verify_session, kind: MapsUsageKind
) -> None:
    sessionmaker = make_sessionmaker(engine)
    [user] = await _users(verify_session, 1)
    limits = DailyLimits(per_account=2, team=10)

    results = [await _charge(sessionmaker, user, kind, limits) for _ in range(3)]

    assert results == [None, None, SpentBy.ACCOUNT]


@KINDS
async def test_the_team_limit_refuses_every_account(
    engine, verify_session, kind: MapsUsageKind
) -> None:
    sessionmaker = make_sessionmaker(engine)
    first, second, third = await _users(verify_session, 3)
    limits = DailyLimits(per_account=5, team=2)

    # None is work no account asked for, which only the team pays for.
    charged = (first, None, second, third, None)

    results = [await _charge(sessionmaker, user, kind, limits) for user in charged]

    assert results == [None, None, SpentBy.TEAM, SpentBy.TEAM, SpentBy.TEAM]
    team = await verify_session.scalar(
        select(MapsUsage.count).where(MapsUsage.user_id.is_(None), MapsUsage.kind == kind.value)
    )
    assert team == limits.team


@KINDS
async def test_a_new_day_resets_both_budgets(engine, verify_session, kind: MapsUsageKind) -> None:
    sessionmaker = make_sessionmaker(engine)
    first, second = await _users(verify_session, 2)
    limits = DailyLimits(per_account=1, team=1)
    assert await _charge(sessionmaker, first, kind, limits) is None
    assert await _charge(sessionmaker, first, kind, limits) is SpentBy.ACCOUNT
    assert await _charge(sessionmaker, second, kind, limits) is SpentBy.TEAM

    after = MIDNIGHT + timedelta(seconds=1)

    assert await _charge(sessionmaker, first, kind, limits, now=after) is None
    assert await _charge(sessionmaker, second, kind, limits, now=after + timedelta(days=1)) is None


@KINDS
@pytest.mark.parametrize(
    ("accounts", "limits", "allowed"),
    [
        pytest.param(1, DailyLimits(per_account=3, team=100), 3, id="one-account"),
        pytest.param(4, DailyLimits(per_account=100, team=5), 5, id="team"),
    ],
)
async def test_concurrent_charges_never_pass_a_limit(
    engine,
    verify_session,
    kind: MapsUsageKind,
    accounts: int,
    limits: DailyLimits,
    allowed: int,
) -> None:
    sessionmaker = make_sessionmaker(engine)
    users = await _users(verify_session, accounts)
    results: list[SpentBy | None] = []

    async def one(user: uuid.UUID) -> None:
        results.append(await _charge(sessionmaker, user, kind, limits))

    async with anyio.create_task_group() as group:
        for i in range(12):
            group.start_soon(one, users[i % accounts])

    assert results.count(None) == allowed
    team = await verify_session.scalar(
        select(MapsUsage.count).where(MapsUsage.user_id.is_(None), MapsUsage.kind == kind.value)
    )
    assert team == allowed


async def test_prune_keeps_only_recent_days(engine, verify_session) -> None:
    sessionmaker = make_sessionmaker(engine)
    [user] = await _users(verify_session, 1)
    limits = DailyLimits(per_account=5, team=5)
    for days_ago in (KEPT_DAYS + 1, KEPT_DAYS, 0):
        now = LATE - timedelta(days=days_ago)
        assert await _charge(sessionmaker, user, MapsUsageKind.SNAPSHOT, limits, now=now) is None

    async with sessionmaker() as session, session.begin():
        await prune(session, now=LATE)

    days = await verify_session.scalars(select(MapsUsage.day).distinct().order_by(MapsUsage.day))
    assert list(days) == [(LATE - timedelta(days=d)).date() for d in (KEPT_DAYS, 0)]
