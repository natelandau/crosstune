"""Bring a user's paid access in line with what RevenueCat reports."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select, tuple_

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import mirror_paid_grants
from crosstune.db.locks import lock_user
from crosstune.models import Grant, User
from crosstune.vocabulary import GrantEnvironment, GrantSource

if TYPE_CHECKING:
    import uuid
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.billing.grants import PaidSubscription
    from crosstune.billing.revenuecat import RevenueCat
    from crosstune.config import Settings


def _accepted(subscriptions: list[PaidSubscription], settings: Settings) -> list[PaidSubscription]:
    """Drop sandbox Stripe subscriptions unless this API accepts them; sandbox Apple always counts.

    A dropped subscription reads as gone, so the mirror also ends any grant it had.
    """
    if settings.billing_accept_sandbox_stripe:
        return subscriptions
    return [
        sub
        for sub in subscriptions
        if not (sub.source == GrantSource.STRIPE and sub.environment == GrantEnvironment.SANDBOX)
    ]


async def _holders(
    session: AsyncSession, fetched: list[tuple[User, list[PaidSubscription]]]
) -> set[uuid.UUID]:
    """The accounts that hold any of the fetched subscriptions now, which the mirror may move."""
    pairs = [(sub.source.value, sub.store_id) for _, subs in fetched for sub in subs]
    if not pairs:
        return set()
    return set(
        (
            await session.scalars(
                select(Grant.user_id).where(tuple_(Grant.source, Grant.external_id).in_(pairs))
            )
        ).all()
    )


async def refresh_purchases(
    session: AsyncSession,
    user: User,
    revenuecat: RevenueCat,
    settings: Settings,
    now: datetime,
) -> None:
    """Mirror the user's RevenueCat subscriptions into grants and refresh their entitlement.

    Raises:
        RevenueCatUnavailableError: RevenueCat did not answer; nothing was written.
    """
    await refresh_many_purchases(session, [user], revenuecat, settings, now)


async def refresh_many_purchases(
    session: AsyncSession,
    users: Sequence[User],
    revenuecat: RevenueCat,
    settings: Settings,
    now: datetime,
) -> None:
    """Refresh several users in one transaction.

    Raises:
        RevenueCatUnavailableError: RevenueCat did not answer for a user; nothing was written.
    """
    # Locks last to the end of the transaction, so every network call comes before the first.
    fetched = [
        (user, _accepted(await revenuecat.subscriptions(user.clerk_user_id, now=now), settings))
        for user in users
    ]
    refreshed = {user.id for user in users}
    # A subscription moving away leaves its old account's entitlement stale, so that account is
    # locked and refreshed too. A stable order keeps concurrent calls from deadlocking.
    for user_id in sorted(refreshed | await _holders(session, fetched)):
        await lock_user(session, user_id)
    moved_from: set[uuid.UUID] = set()
    for user, subscriptions in sorted(fetched, key=lambda pair: pair[0].id):
        # Account deletion holds the same lock, so a user it removed is gone by now.
        if await session.scalar(select(User.id).where(User.id == user.id)) is None:
            continue
        moved_from |= await mirror_paid_grants(session, user.id, subscriptions, now)
        await refresh_entitlement(session, user.id, settings, now)
    for user_id in sorted(moved_from - refreshed):
        await refresh_entitlement(session, user_id, settings, now)
