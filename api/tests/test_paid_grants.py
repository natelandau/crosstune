"""Paid grants mirror the billing provider's subscriptions."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.billing.grants import (
    PaidSubscription,
    grant_comp,
    mirror_paid_grants,
    start_trial,
)
from crosstune.models import Grant
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource
from tests.helpers import T0

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from crosstune.models import User

pytestmark = pytest.mark.anyio

NOW = T0


def _sub(
    store_id: str,
    source: GrantSource = GrantSource.APPLE,
    *,
    days: int | None = 30,
    kind: GrantKind = GrantKind.PREMIUM,
    environment: GrantEnvironment = GrantEnvironment.PRODUCTION,
    auto_renews: bool = True,
) -> PaidSubscription:
    return PaidSubscription(
        store_id=store_id,
        source=source,
        kind=kind,
        environment=environment,
        expires_at=None if days is None else NOW + timedelta(days=days),
        auto_renews=auto_renews,
    )


async def _user(session: AsyncSession, settings: Settings, clerk_id: str = "user_paid") -> User:
    return await get_or_create_user(session, clerk_id, f"{clerk_id}@example.com", settings)


async def _grants(session: AsyncSession, user: User, *sources: GrantSource) -> list[Grant]:
    rows = await session.scalars(
        select(Grant)
        .where(Grant.user_id == user.id, Grant.source.in_([s.value for s in sources]))
        .order_by(Grant.external_id)
        .execution_options(populate_existing=True)
    )
    return list(rows.all())


async def test_mirror_writes_one_grant_per_subscription(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    apple = _sub("1000", GrantSource.APPLE, environment=GrantEnvironment.SANDBOX)
    stripe = _sub("sub_abc", GrantSource.STRIPE, days=365, auto_renews=False)

    await mirror_paid_grants(session, user.id, [apple, stripe], NOW)

    rows = await _grants(session, user, GrantSource.APPLE, GrantSource.STRIPE)
    assert [
        (r.source, r.external_id, r.kind, r.environment, r.expires_at, r.auto_renews) for r in rows
    ] == [
        ("apple", "1000", "premium", "sandbox", apple.expires_at, True),
        ("stripe", "sub_abc", "premium", "production", stripe.expires_at, False),
    ]


async def test_mirror_updates_in_place(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await mirror_paid_grants(session, user.id, [_sub("1000")], NOW)
    later = _sub("1000", days=60, auto_renews=False)

    await mirror_paid_grants(session, user.id, [later], NOW)

    (row,) = await _grants(session, user, GrantSource.APPLE)
    assert row.expires_at == later.expires_at
    assert row.auto_renews is False


async def test_mirror_expires_a_vanished_subscription(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    old = NOW - timedelta(days=3)
    await mirror_paid_grants(
        session,
        user.id,
        [_sub("1000"), _sub("sub_old", GrantSource.STRIPE, days=-3), _sub("2000", days=None)],
        NOW - timedelta(days=10),
    )

    await mirror_paid_grants(session, user.id, [_sub("2000", days=None)], NOW)

    rows = {
        r.external_id: r
        for r in await _grants(session, user, GrantSource.APPLE, GrantSource.STRIPE)
    }
    assert rows["1000"].expires_at == NOW
    assert rows["sub_old"].expires_at == old
    assert rows["2000"].expires_at is None


async def test_mirror_moves_a_subscription_between_accounts(
    session: AsyncSession, settings: Settings
) -> None:
    first = await _user(session, settings, "user_a")
    second = await _user(session, settings, "user_b")
    await mirror_paid_grants(session, first.id, [_sub("1000")], NOW)

    await mirror_paid_grants(session, second.id, [_sub("1000", days=45)], NOW)

    assert await _grants(session, first, GrantSource.APPLE) == []
    (row,) = await _grants(session, second, GrantSource.APPLE)
    assert row.external_id == "1000"
    assert row.expires_at == NOW + timedelta(days=45)


async def test_active_paid_grant_ends_the_trial(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await start_trial(session, user.id, settings, NOW)

    await mirror_paid_grants(session, user.id, [_sub("1000")], NOW)

    (trial,) = await _grants(session, user, GrantSource.TRIAL)
    assert trial.expires_at == NOW


async def test_expired_paid_grant_leaves_the_trial_running(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    trial = await start_trial(session, user.id, settings, NOW)
    ends = trial.expires_at

    await mirror_paid_grants(session, user.id, [_sub("1000", days=-1)], NOW)

    (trial,) = await _grants(session, user, GrantSource.TRIAL)
    assert trial.expires_at == ends


async def test_mirror_leaves_comps_alone(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    comp = await grant_comp(
        session, user.id, expires_at=None, storage_addon=False, granted_by="t", reason="r", now=NOW
    )

    await mirror_paid_grants(session, user.id, [], NOW)

    (row,) = await _grants(session, user, GrantSource.COMP)
    assert row.id == comp.id
    assert row.expires_at is None


async def test_mirror_stamps_updates_with_the_callers_now(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await mirror_paid_grants(session, user.id, [_sub("1000")], NOW)

    await mirror_paid_grants(session, user.id, [_sub("1000", days=60)], NOW + timedelta(days=1))

    (row,) = await _grants(session, user, GrantSource.APPLE)
    assert row.updated_at == NOW + timedelta(days=1)


async def test_a_moved_subscription_ends_the_new_owners_trial(
    session: AsyncSession, settings: Settings
) -> None:
    first = await _user(session, settings, "user_a")
    second = await _user(session, settings, "user_b")
    await mirror_paid_grants(session, first.id, [_sub("1000")], NOW)
    await start_trial(session, second.id, settings, NOW)

    await mirror_paid_grants(session, second.id, [_sub("1000")], NOW)

    (trial,) = await _grants(session, second, GrantSource.TRIAL)
    assert trial.expires_at == NOW


async def test_a_storage_addon_subscription_leaves_the_trial_running(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    trial = await start_trial(session, user.id, settings, NOW)
    ends = trial.expires_at

    await mirror_paid_grants(session, user.id, [_sub("1000", kind=GrantKind.STORAGE_ADDON)], NOW)

    (trial,) = await _grants(session, user, GrantSource.TRIAL)
    assert trial.expires_at == ends


async def test_mirror_writes_an_environment_change(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    await mirror_paid_grants(
        session, user.id, [_sub("1000", environment=GrantEnvironment.SANDBOX)], NOW
    )

    await mirror_paid_grants(session, user.id, [_sub("1000")], NOW)

    (row,) = await _grants(session, user, GrantSource.APPLE)
    assert row.environment == "production"


async def test_a_store_id_listed_twice_leaves_one_row(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)

    await mirror_paid_grants(session, user.id, [_sub("1000"), _sub("1000", days=45)], NOW)

    (row,) = await _grants(session, user, GrantSource.APPLE)
    assert row.expires_at == NOW + timedelta(days=45)
