"""Ending a user's paid billing when the account is deleted."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import or_, select

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
    from crosstune.models import User

_CANNOT_END_BILLING = "Could not end billing for the account"


async def end_billing(
    session: AsyncSession,
    user: User,
    stripe: StripeSubscriptions | None,
    revenuecat: RevenueCat | None,
    now: datetime,
) -> None:
    """Cancel the user's live Stripe subscriptions, then delete their RevenueCat customer.

    A subscription is live while its grant is active or still renews, as one in a payment
    retry does after its access lapsed.

    Apple grants are left alone: the app cannot cancel an App Store subscription.

    Args:
        session: The session to read grants through.
        user: The account being deleted.
        stripe: The Stripe client, or None when Stripe is not configured.
        revenuecat: The RevenueCat client, or None when RevenueCat is not configured.
        now: The instant that decides which grants are still active.

    Raises:
        AccountDeletionUnavailableError: A live Stripe subscription exists and Stripe is not configured.
        AccountDeletionFailedError: Stripe or RevenueCat did not confirm.
    """
    external_ids = (
        await session.scalars(
            select(Grant.external_id).where(
                Grant.user_id == user.id,
                Grant.source == GrantSource.STRIPE.value,
                # A lapsed grant still renewing is a subscription Stripe keeps retrying to charge.
                or_(Grant.expires_at.is_(None), Grant.expires_at > now, Grant.auto_renews),
            )
        )
    ).all()
    subscription_ids = [external_id for external_id in external_ids if external_id is not None]
    if subscription_ids and stripe is None:
        raise AccountDeletionUnavailableError(_CANNOT_END_BILLING)
    try:
        if stripe is not None:
            for subscription_id in subscription_ids:
                await stripe.cancel(subscription_id)
        if revenuecat is not None:
            await revenuecat.delete_customer(user.clerk_user_id)
    except (StripeUnavailableError, RevenueCatUnavailableError) as exc:
        raise AccountDeletionFailedError(_CANNOT_END_BILLING) from exc
