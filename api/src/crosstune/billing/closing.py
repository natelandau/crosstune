"""Ending a user's paid billing when the account is deleted."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from crosstune.billing.purchases import accepted
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.stripe import StripeUnavailableError
from crosstune.errors import AccountDeletionFailedError, AccountDeletionUnavailableError
from crosstune.models import Grant
from crosstune.vocabulary import GrantSource

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.billing.revenuecat import RevenueCat
    from crosstune.billing.stripe import StripeSubscriptions
    from crosstune.config import Settings
    from crosstune.models import User

_CANNOT_END_BILLING = "Could not end billing for the account"


async def end_billing(
    session: AsyncSession,
    user: User,
    stripe: StripeSubscriptions | None,
    revenuecat: RevenueCat | None,
    settings: Settings,
    now: datetime,
) -> None:
    """Cancel the user's live Stripe subscriptions, then delete their RevenueCat customer.

    A subscription is live while it is active or still renews, as one in a payment retry does
    after its access lapsed.

    RevenueCat names the subscriptions to cancel, read at deletion time. A grant's ID is
    RevenueCat's subscription ID, which Stripe cannot cancel, so without RevenueCat a live
    Stripe grant blocks deletion.

    Apple subscriptions are left alone: the app cannot cancel an App Store subscription.

    Args:
        session: The session to read grants through when RevenueCat is not configured.
        user: The account being deleted.
        stripe: The Stripe client, or None when Stripe is not configured.
        revenuecat: The RevenueCat client, or None when RevenueCat is not configured.
        settings: Decide whether sandbox Stripe subscriptions belong to this API's Stripe key.
        now: The instant that decides which subscriptions are still live.

    Raises:
        AccountDeletionUnavailableError: A live Stripe subscription exists and Stripe is not configured,
            or RevenueCat is not configured and the user holds a live Stripe grant.
        AccountDeletionFailedError: Stripe or RevenueCat did not confirm.
    """
    try:
        if revenuecat is None:
            if await _has_live_stripe_grant(session, user, now):
                raise AccountDeletionUnavailableError(_CANNOT_END_BILLING)
            return
        store_ids = await _live_from_revenuecat(user, revenuecat, settings, now)
        if store_ids and stripe is None:
            raise AccountDeletionUnavailableError(_CANNOT_END_BILLING)
        if stripe is not None:
            for store_id in store_ids:
                await stripe.cancel(store_id)
        await revenuecat.delete_customer(user.clerk_user_id)
    except (StripeUnavailableError, RevenueCatUnavailableError) as exc:
        raise AccountDeletionFailedError(_CANNOT_END_BILLING) from exc


async def _live_from_revenuecat(
    user: User, revenuecat: RevenueCat, settings: Settings, now: datetime
) -> list[str]:
    subscriptions = accepted(await revenuecat.subscriptions(user.clerk_user_id, now=now), settings)
    return [
        sub.store_id
        for sub in subscriptions
        if sub.source == GrantSource.STRIPE
        and (sub.expires_at is None or sub.expires_at > now or sub.auto_renews)
    ]


async def _has_live_stripe_grant(session: AsyncSession, user: User, now: datetime) -> bool:
    return (
        await session.scalar(
            select(Grant.id)
            .where(
                Grant.user_id == user.id,
                Grant.source == GrantSource.STRIPE.value,
                or_(Grant.expires_at.is_(None), Grant.expires_at > now, Grant.auto_renews),
            )
            .limit(1)
        )
        is not None
    )
