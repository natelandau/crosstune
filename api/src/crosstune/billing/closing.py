"""Ending a user's paid billing when the account is deleted."""

from __future__ import annotations

from functools import partial
from typing import TYPE_CHECKING

from sqlalchemy import or_, select

from crosstune.billing.access import live_stripe_grant, withdrawal_window_open
from crosstune.billing.purchases import accepted
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.stripe import StripeUnavailableError
from crosstune.billing.withdrawal import PENDING, mark_withdrawn, refund_key, send_confirmation
from crosstune.db.locks import lock_user
from crosstune.errors import AccountDeletionFailedError, AccountDeletionUnavailableError
from crosstune.models import Grant, User
from crosstune.vocabulary import GrantSource

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.billing.revenuecat import RevenueCat
    from crosstune.billing.stripe import StripeSubscriptions
    from crosstune.config import Settings
    from crosstune.email.resend import Mailer

_CANNOT_END_BILLING = "Could not end billing for the account"


class _AccountGone(Exception):  # noqa: N818 -- a signal, not an error
    """The account's rows went away while the deletion committed a step."""


async def end_billing(
    session: AsyncSession,
    user: User,
    stripe: StripeSubscriptions | None,
    revenuecat: RevenueCat | None,
    settings: Settings,
    now: datetime,
    mailer: Mailer | None = None,
) -> Callable[[AsyncSession], Awaitable[None]] | None:
    """Cancel the user's live Stripe subscriptions, then delete their RevenueCat customer.

    A live web subscription inside its withdrawal window, for an account that has not
    withdrawn, has its first payment refunded in full before it is cancelled. The refund
    uses the same idempotency key as a withdrawal, so one never refunds twice.

    A refunded subscription whose cancel never went through (a pending withdrawal) is
    cancelled through its stored Stripe item whether or not RevenueCat still lists it, since
    the purge removes the only record of it.

    Each refund and each completed withdrawal is committed as soon as Stripe confirms it, and
    the user lock taken again, so an account that survives a later failure keeps the record
    and a retry never refunds a second time. The caller holds the user's billing lock
    (`billing_lock`) around this and the purge, so no withdrawal, pass, or second deletion
    starts between those commits. Rows another writer changed meanwhile are read again, and
    an account found gone ends the call with nothing to send.

    A subscription is live while it is active or still renews, as one in a payment retry does
    after its access lapsed.

    RevenueCat names the subscriptions to cancel, read at deletion time. A grant's ID is
    RevenueCat's subscription ID, which Stripe cannot cancel, so without RevenueCat a live
    Stripe grant blocks deletion.

    Apple subscriptions are left alone: the app cannot cancel an App Store subscription.

    Args:
        session: The session to read and record grants through. It is committed here.
        user: The account being deleted, loaded through `session`.
        stripe: The Stripe client, or None when Stripe is not configured.
        revenuecat: The RevenueCat client, or None when RevenueCat is not configured.
        settings: Decide whether sandbox Stripe subscriptions belong to this API's Stripe key.
        now: The instant that decides which subscriptions are still live.
        mailer: Sends the withdrawal email, or None when mail is not configured.

    Returns:
        The coroutine function that sends the refund email and records its notice, through
        the session it is given, for each refund this call made or each pending withdrawal
        it completed. None when it handled neither. The caller runs it only after the
        deletion commits. An older withdrawal whose email was never sent is left to the
        daily notice pass, since this email says the refund came with the deletion.

    Raises:
        AccountDeletionUnavailableError: A live Stripe subscription exists and Stripe is not configured,
            or RevenueCat is not configured and the user holds a live Stripe grant.
        AccountDeletionFailedError: Stripe or RevenueCat did not confirm, or a pending
            withdrawal has no Stripe item to cancel.
    """
    try:
        pending = await _pending(session, user)
        if revenuecat is None:
            if await _has_live_stripe_grant(session, user, now):
                raise AccountDeletionUnavailableError(_CANNOT_END_BILLING)
            store_ids: list[tuple[str, str]] = []
        else:
            store_ids = await _live_from_revenuecat(user, revenuecat, settings, now)
        refunded: list[str] = []
        if stripe is None:
            if store_ids or pending:
                raise AccountDeletionUnavailableError(_CANNOT_END_BILLING)
        else:
            refunded = await _cancel_all(session, user, stripe, store_ids, pending, settings, now)
        if revenuecat is not None:
            await revenuecat.delete_customer(user.clerk_user_id)
    except (StripeUnavailableError, RevenueCatUnavailableError) as exc:
        raise AccountDeletionFailedError(_CANNOT_END_BILLING) from exc
    except _AccountGone:
        # Another deletion finished this account; the caller's purge then finds nothing.
        return None
    if user.email is None or mailer is None or not refunded:
        return None
    return partial(
        _confirm_all, mailer=mailer, email=user.email, subscription_ids=refunded, settings=settings
    )


async def _confirm_all(
    session: AsyncSession,
    *,
    mailer: Mailer,
    email: str,
    subscription_ids: Sequence[str],
    settings: Settings,
) -> None:
    for subscription_id in subscription_ids:
        await send_confirmation(
            session, mailer, email, subscription_id, settings, account_deleted=True
        )


async def _cancel_all(
    session: AsyncSession,
    user: User,
    stripe: StripeSubscriptions,
    store_ids: list[tuple[str, str]],
    pending: Sequence[Grant],
    settings: Settings,
    now: datetime,
) -> list[str]:
    """Finish pending withdrawals, refund then cancel the one in its window, cancel the rest.

    Returns:
        The subscriptions whose withdrawal this call refunded or completed.

    Raises:
        AccountDeletionFailedError: A pending withdrawal has no Stripe item to cancel.
        StripeUnavailableError: Stripe did not confirm a refund or a cancel.
    """
    listed = {subscription_id: store_id for store_id, subscription_id in store_ids}
    handled: list[str] = []
    for stale in pending:
        # An earlier step's commit let other writers in, so each grant is read again.
        grant = await _reread(session, user, stale)
        if grant.withdrawn_at is not None:
            listed.pop(grant.external_id or "", None)
            continue
        store_id = listed.pop(grant.external_id or "", None) or grant.store_id
        if store_id is None:
            raise AccountDeletionFailedError(_CANNOT_END_BILLING)
        await stripe.cancel(store_id)
        await _withdrawn(session, user, grant, settings, now)
        if grant.external_id is not None:
            handled.append(grant.external_id)

    grant = await _refundable(session, user, now)
    if grant is not None and grant.external_id in listed:
        subscription_id = grant.external_id
        store_id = listed.pop(subscription_id)
        await stripe.refund(
            await stripe.first_payment_intent(store_id),
            idempotency_key=refund_key(subscription_id),
        )
        grant.refunded_at = now
        grant.store_id = store_id
        await _commit(session, user)
        grant = await _reread(session, user, grant)
        await stripe.cancel(store_id)
        await _withdrawn(session, user, grant, settings, now)
        handled.append(subscription_id)

    for store_id in listed.values():
        await stripe.cancel(store_id)
    return handled


async def _withdrawn(
    session: AsyncSession, user: User, grant: Grant, settings: Settings, now: datetime
) -> None:
    if grant.withdrawn_at is None:
        await mark_withdrawn(session, user, grant, settings, now)
        await _commit(session, user)


async def _reread(session: AsyncSession, user: User, grant: Grant) -> Grant:
    """The grant and the user as committed now, read under the user lock.

    Raises:
        _AccountGone: Either row was deleted.
    """
    fresh_user = await session.scalar(
        select(User).where(User.id == user.id).execution_options(populate_existing=True)
    )
    fresh = await session.scalar(
        select(Grant).where(Grant.id == grant.id).execution_options(populate_existing=True)
    )
    if fresh_user is None or fresh is None:
        raise _AccountGone
    return fresh


async def _commit(session: AsyncSession, user: User) -> None:
    """Commit what Stripe confirmed, then hold the user lock again for the rest of the deletion."""
    await session.commit()
    await lock_user(session, user.id)


async def _pending(session: AsyncSession, user: User) -> Sequence[Grant]:
    """The user's grants whose refund went through but whose subscription is not cancelled."""
    return (
        await session.scalars(
            select(Grant)
            .where(Grant.user_id == user.id, Grant.external_id.is_not(None), *PENDING)
            .execution_options(populate_existing=True)
        )
    ).all()


async def _refundable(session: AsyncSession, user: User, now: datetime) -> Grant | None:
    """The live web grant still inside its window, for an account that has not withdrawn.

    `withdrew_at` is read here, under the caller's user lock.
    """
    if await session.scalar(select(User.withdrew_at).where(User.id == user.id)) is not None:
        return None
    grants = (
        await session.scalars(
            select(Grant).where(Grant.user_id == user.id).execution_options(populate_existing=True)
        )
    ).all()
    grant = live_stripe_grant(grants, now)
    if (
        grant is None
        or grant.external_id is None
        or grant.refunded_at is not None
        or not withdrawal_window_open(grant, now)
    ):
        return None
    return grant


async def _live_from_revenuecat(
    user: User, revenuecat: RevenueCat, settings: Settings, now: datetime
) -> list[tuple[str, str]]:
    subscriptions = accepted(await revenuecat.subscriptions(user.clerk_user_id, now=now), settings)
    return [
        (sub.store_id, sub.subscription_id)
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
