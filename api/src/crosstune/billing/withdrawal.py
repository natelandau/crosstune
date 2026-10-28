"""A web subscriber's withdrawal: a full refund of the first payment within the window, once."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError

from crosstune.billing.access import (
    live_stripe_grant,
    refresh_entitlement,
    withdrawal_window_open,
)
from crosstune.billing.emails import notice_key, withdrawal_email
from crosstune.billing.notices import notice_recorded, record_notice
from crosstune.billing.revenuecat import RevenueCatUnavailableError
from crosstune.billing.stripe import StripeUnavailableError
from crosstune.db.base import utc_now
from crosstune.db.locks import billing_lock, lock_user
from crosstune.email.resend import MailerUnavailableError
from crosstune.errors import BillingUnavailableError, WithdrawalRefusedError
from crosstune.models import Grant, User
from crosstune.vocabulary import BillingNoticeKind, GrantSource

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.billing.revenuecat import RevenueCat
    from crosstune.billing.stripe import StripeSubscriptions
    from crosstune.config import Settings
    from crosstune.email.resend import Mailer

log = logging.getLogger(__name__)

_CANNOT_WITHDRAW = "Could not reach the billing provider to withdraw"

PENDING = (Grant.refunded_at.is_not(None), Grant.withdrawn_at.is_(None))
"""A grant whose refund went through but whose subscription is not yet cancelled."""


async def withdraw(  # noqa: PLR0913 -- each client is injected so callers and tests choose it
    session: AsyncSession,
    user: User,
    stripe: StripeSubscriptions,
    revenuecat: RevenueCat,
    mailer: Mailer | None,
    settings: Settings,
    now: datetime,
    *,
    allow_repeat: bool = False,
    lock_wait_seconds: float | None = None,
) -> None:
    """Refund the user's web subscription in full, cancel it, end Premium, and commit.

    The refund is recorded on the grant (`refunded_at`) and committed before the cancel, so
    a refund whose cancel failed is never lost: a retry, or `complete_pending_withdrawals`,
    finishes it without refunding again. The user lock is held from before the refund until
    that commit, and `withdrew_at` and the grants are read under it, so two calls at once
    refund once. The whole run holds the user's billing lock, so an account deletion never
    starts between the refund and the cancel.

    The confirmation email goes out after the final commit. A failed send is logged, never
    raised, since the refund already happened.

    Args:
        session: The session to write through. It is committed here.
        user: The account withdrawing, loaded through `session`.
        stripe: Refunds and cancels the subscription.
        revenuecat: Names the Stripe subscription item behind the grant.
        mailer: Sends the confirmation, or None when mail is not configured.
        settings: The web origin for the email and the quotas for the entitlement.
        now: The instant the window is judged against and the withdrawal is stamped with.
        allow_repeat: Let an account that already withdrew once withdraw again.
        lock_wait_seconds: How long to wait on the account's billing and user locks before
            refusing, or None to wait as long as another holder keeps them.

    Raises:
        WithdrawalRefusedError: Already withdrawn, no live web subscription, or the window closed.
        BillingUnavailableError: Stripe or RevenueCat did not confirm.
    """
    async with billing_lock(session, user.id, wait_seconds=lock_wait_seconds):
        await lock_user(session, user.id, wait_seconds=lock_wait_seconds)
        pending = await session.scalar(
            select(Grant.id).where(Grant.user_id == user.id, *PENDING).limit(1)
        )
        grant_id = pending or await _refund(
            session, user, stripe=stripe, revenuecat=revenuecat, now=now, allow_repeat=allow_repeat
        )
        await _finish(
            session,
            user.id,
            grant_id,
            stripe=stripe,
            revenuecat=revenuecat,
            mailer=mailer,
            settings=settings,
            now=now,
        )


async def complete_pending_withdrawals(
    sessionmaker: async_sessionmaker[AsyncSession],
    stripe: StripeSubscriptions,
    revenuecat: RevenueCat,
    mailer: Mailer | None,
    settings: Settings,
    now: datetime,
) -> int:
    """Cancel and end every refunded withdrawal whose cancel has not gone through yet.

    Each grant is finished in its own transaction under its user's lock. One whose account
    a deletion or withdrawal is working on is skipped for now. One that still fails, for any
    reason, is logged at ERROR, left pending, and skipped.

    Returns:
        How many withdrawals this pass completed.
    """
    async with sessionmaker() as session:
        pending = (await session.execute(select(Grant.id, Grant.user_id).where(*PENDING))).all()
    completed = 0
    for grant_id, user_id in pending:
        async with sessionmaker() as session:
            try:
                async with billing_lock(session, user_id, wait=False) as held:
                    if not held:
                        # A deletion or withdrawal is finishing this account's billing.
                        continue
                    finished = await _finish(
                        session,
                        user_id,
                        grant_id,
                        stripe=stripe,
                        revenuecat=revenuecat,
                        mailer=mailer,
                        settings=settings,
                        now=now,
                    )
            except BillingUnavailableError:
                continue  # _finish logged it at ERROR
            except Exception:
                # One grant that fails in an unforeseen way must not hold up the rest.
                log.exception(
                    "could not complete a pending withdrawal",
                    extra={"user": str(user_id), "grant": str(grant_id)},
                )
                continue
        completed += finished
    return completed


async def _refund(
    session: AsyncSession,
    user: User,
    *,
    stripe: StripeSubscriptions,
    revenuecat: RevenueCat,
    now: datetime,
    allow_repeat: bool,
) -> uuid.UUID:
    """Check the user may withdraw, refund the first payment, and commit the refund.

    Returns:
        The refunded grant's id.

    Raises:
        WithdrawalRefusedError: Already withdrawn, no live web subscription, or the window closed.
        BillingUnavailableError: RevenueCat or Stripe did not confirm; nothing was written.
    """
    withdrew_at = await session.scalar(select(User.withdrew_at).where(User.id == user.id))
    if withdrew_at is not None and not allow_repeat:
        raise WithdrawalRefusedError(reason="already_withdrawn")
    grants = (
        await session.scalars(
            select(Grant).where(Grant.user_id == user.id).execution_options(populate_existing=True)
        )
    ).all()
    grant = live_stripe_grant(grants, now)
    if grant is None or grant.started_at is None or grant.external_id is None:
        raise WithdrawalRefusedError(reason="no_web_subscription")
    if not withdrawal_window_open(grant, now):
        raise WithdrawalRefusedError(reason="window_closed")

    subscription_id = grant.external_id
    store_id: str | None = None
    try:
        store_id = await _listed_store_id(revenuecat, user.clerk_user_id, subscription_id, now)
        if store_id is not None:
            payment_intent = await stripe.first_payment_intent(store_id)
            await stripe.refund(payment_intent, idempotency_key=refund_key(subscription_id))
    except (StripeUnavailableError, RevenueCatUnavailableError) as exc:
        log.warning(
            "could not refund a withdrawal; nothing was recorded",
            extra={"user": str(user.id), "subscription": subscription_id, "store_id": store_id},
        )
        raise BillingUnavailableError(_CANNOT_WITHDRAW) from exc
    if store_id is None:
        log.warning(
            "RevenueCat lists no Stripe item for a withdrawal; nothing was recorded",
            extra={"user": str(user.id), "subscription": subscription_id},
        )
        raise BillingUnavailableError(_CANNOT_WITHDRAW)

    grant.refunded_at = now
    grant.store_id = store_id
    grant_id = grant.id
    await session.commit()
    return grant_id


async def _finish(  # noqa: PLR0913 -- each client is injected
    session: AsyncSession,
    user_id: uuid.UUID,
    grant_id: uuid.UUID,
    *,
    stripe: StripeSubscriptions,
    revenuecat: RevenueCat,
    mailer: Mailer | None,
    settings: Settings,
    now: datetime,
) -> bool:
    """Cancel a refunded grant's subscription, end the grant, commit, then email.

    Does not depend on the grant still being live: a refresh after the refund may have
    ended it already.

    Returns:
        False when the grant is no longer pending, as when a concurrent call completed it.

    Raises:
        BillingUnavailableError: No store id to cancel, or Stripe did not confirm the cancel.
    """
    await lock_user(session, user_id)
    grant = await session.scalar(
        select(Grant)
        .where(Grant.id == grant_id, *PENDING)
        .execution_options(populate_existing=True)
    )
    user = await session.scalar(
        select(User).where(User.id == user_id).execution_options(populate_existing=True)
    )
    if grant is None or user is None or grant.external_id is None:
        return False
    subscription_id = grant.external_id
    try:
        listed = await _listed_store_id(revenuecat, user.clerk_user_id, subscription_id, now)
    except RevenueCatUnavailableError:
        listed = None
    store_id = listed or grant.store_id
    ids = {"user": str(user_id), "subscription": subscription_id, "store_id": store_id}
    if store_id is None:
        log.error("a refunded withdrawal has no Stripe item to cancel", extra=ids)
        raise BillingUnavailableError(_CANNOT_WITHDRAW)
    try:
        await stripe.cancel(store_id)
    except StripeUnavailableError as exc:
        log.error("could not cancel a refunded withdrawal", extra=ids)  # noqa: TRY400
        raise BillingUnavailableError(_CANNOT_WITHDRAW) from exc

    await mark_withdrawn(session, user, grant, settings, now)
    email = user.email
    await session.commit()

    if email is not None and mailer is not None:
        await send_confirmation(session, mailer, email, subscription_id, settings)
    return True


async def mark_withdrawn(
    session: AsyncSession, user: User, grant: Grant, settings: Settings, now: datetime
) -> None:
    """End a refunded grant whose subscription is cancelled, and spend the account's withdrawal."""
    grant.withdrawn_at = now
    if grant.expires_at is None or grant.expires_at > now:
        grant.expires_at = now
    grant.auto_renews = False
    user.withdrew_at = now
    await session.flush()
    await refresh_entitlement(session, user.id, settings, now)


def refund_key(subscription_id: str) -> str:
    """The Stripe idempotency key for a subscription's withdrawal refund.

    A withdrawal and an account deletion share it, so together they refund at most once.
    """
    return f"withdraw:{subscription_id}"


async def _listed_store_id(
    revenuecat: RevenueCat, clerk_user_id: str, subscription_id: str, now: datetime
) -> str | None:
    """The Stripe subscription item RevenueCat reports for the subscription, if it lists it.

    Raises:
        RevenueCatUnavailableError: RevenueCat did not answer.
    """
    for sub in await revenuecat.subscriptions(clerk_user_id, now=now):
        if sub.source == GrantSource.STRIPE and sub.subscription_id == subscription_id:
            return sub.store_id
    return None


async def send_confirmation(
    session: AsyncSession,
    mailer: Mailer,
    email: str,
    subscription_id: str,
    settings: Settings,
    *,
    account_deleted: bool = False,
) -> None:
    """Email the withdrawal confirmation once and record it, logging a refused send or record.

    Args:
        session: Reads and commits the withdrawal notice. Holds no transaction the caller needs.
        mailer: Sends the email.
        email: The address to send to.
        subscription_id: The withdrawn subscription, which keys the notice.
        settings: The web origin the email links to.
        account_deleted: The refund came with an account deletion, which the email says.
    """
    try:
        recorded = await notice_recorded(
            session,
            kind=BillingNoticeKind.WITHDRAWAL,
            subscription_id=subscription_id,
            period_end=None,
        )
    except SQLAlchemyError:
        # The withdrawal already committed; the daily pass sends an email still owed.
        log.exception(
            "could not check for a sent withdrawal email", extra={"subscription": subscription_id}
        )
        return
    if recorded:
        return
    message = withdrawal_email(
        to=email, web_origin=settings.web_origin, account_deleted=account_deleted
    )
    try:
        await mailer.send(message, idempotency_key=notice_key("withdrawal", subscription_id, None))
    except MailerUnavailableError:
        log.warning(
            "Resend did not accept a withdrawal email",
            extra={"subscription": subscription_id},
        )
        return
    try:
        await record_notice(
            session,
            kind=BillingNoticeKind.WITHDRAWAL,
            subscription_id=subscription_id,
            period_end=None,
            sent_at=utc_now(),
        )
    except SQLAlchemyError:
        # The email went out and the withdrawal committed; only the record is missing.
        log.exception(
            "could not record a sent withdrawal email", extra={"subscription": subscription_id}
        )
