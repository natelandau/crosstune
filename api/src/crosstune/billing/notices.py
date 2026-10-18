"""Purchase confirmations, yearly renewal reminders, and withdrawal emails, each sent once.

A notice is recorded only after Resend accepted its email, so a failed send leaves
nothing and the next pass sends it again. The idempotency key names the notice, so a
send whose record failed is not mailed twice within Resend's 24-hour key window. A
retry after that window sends the email again: a failed record can duplicate it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, exists, or_, select, true
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from crosstune.billing.emails import (
    confirmation_email,
    notice_key,
    renewal_reminder_email,
    withdrawal_email,
)
from crosstune.email.layout import to_utc
from crosstune.email.resend import MailerRateLimitedError, MailerUnavailableError
from crosstune.jobs.schedule import claim_run, next_run
from crosstune.models import BillingNotice, Grant, User
from crosstune.vocabulary import BillingNoticeKind, GrantKind, GrantPeriod, GrantSource

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable
    from datetime import datetime

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.email.resend import EmailMessage, Mailer

log = logging.getLogger(__name__)

REMINDER_WINDOW = (timedelta(days=25), timedelta(days=35))
"""How far ahead of a yearly renewal its reminder goes out, inside New York's 15 to 45 days."""
SAME_RENEWAL = timedelta(days=7)
"""How far a renewal's `expires_at` may move and still count as the renewal already reminded.

Well above the drift a store reports for one renewal, well below a billing period.
"""
BILLING_NOTICES_RUN = "billing-notices"
RUN_EVERY = timedelta(days=1)

_PAID_SOURCES = (GrantSource.APPLE.value, GrantSource.STRIPE.value)


@dataclass(frozen=True)
class _Notice:
    """One email owed for one subscription, and the row that records it once sent."""

    kind: BillingNoticeKind
    subscription_id: str
    period_end: datetime | None
    # Kept out of the repr, so an error report's locals never show the address or body.
    message: EmailMessage = field(repr=False)

    @property
    def key(self) -> str:
        return notice_key(self.kind.value, self.subscription_id, self.period_end)


class NoticeNotSentError(Exception):
    """Sending a billing notice failed in a way Resend did not report."""


def _not_sent(kind: BillingNoticeKind, *, per_renewal: bool = False) -> ColumnElement[bool]:
    """Match a grant whose subscription has no notice of `kind` yet, or none for this renewal.

    A renewal's notice matches within `SAME_RENEWAL` of the grant's `expires_at`.
    """
    match = and_(BillingNotice.subscription_id == Grant.external_id, BillingNotice.kind == kind)
    if per_renewal:
        match = and_(
            match,
            BillingNotice.period_end > Grant.expires_at - SAME_RENEWAL,
            BillingNotice.period_end < Grant.expires_at + SAME_RENEWAL,
        )
    return ~exists().where(match)


def _paid() -> ColumnElement[bool]:
    """Match a store subscription whose buyer has an email address."""
    return and_(
        Grant.kind == GrantKind.PREMIUM.value,
        Grant.source.in_(_PAID_SOURCES),
        Grant.external_id.is_not(None),
        User.email.is_not(None),
    )


def _kept(now: datetime) -> ColumnElement[bool]:
    """Match a paid grant that still gives access and was never withdrawn or refunded."""
    return and_(
        _paid(),
        Grant.withdrawn_at.is_(None),
        Grant.refunded_at.is_(None),
        or_(Grant.expires_at.is_(None), Grant.expires_at > now),
    )


async def record_notice(
    session: AsyncSession,
    *,
    kind: BillingNoticeKind,
    subscription_id: str,
    period_end: datetime | None,
    sent_at: datetime,
) -> bool:
    """Record a notice Resend accepted. Commits.

    Returns:
        False when the notice was already recorded, as by a concurrent pass.
    """
    inserted = await session.scalar(
        insert(BillingNotice)
        .values(
            subscription_id=subscription_id, kind=kind.value, period_end=period_end, sent_at=sent_at
        )
        .on_conflict_do_nothing()
        .returning(BillingNotice.id)
    )
    await session.commit()
    return inserted is not None


async def notice_recorded(
    session: AsyncSession,
    *,
    kind: BillingNoticeKind,
    subscription_id: str,
    period_end: datetime | None,
) -> bool:
    """Whether a notice was already sent, so a caller about to send it again can skip it."""
    return (
        await session.scalar(
            select(BillingNotice.id).where(
                BillingNotice.subscription_id == subscription_id,
                BillingNotice.kind == kind.value,
                BillingNotice.period_end.is_(None)
                if period_end is None
                else BillingNotice.period_end == period_end,
            )
        )
        is not None
    )


async def send_confirmations(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    user_ids: Iterable[uuid.UUID],
    now: datetime,
) -> int:
    """Send the purchase confirmation still owed for each of these users' subscriptions.

    Called after a purchase refresh commits, and by the daily pass for any that failed.
    A grant whose period RevenueCat has not reported yet waits for a later pass, since
    the email names how often it bills.

    Returns:
        How many confirmations were sent and recorded.
    """
    ids = list(user_ids)
    if not ids:
        return 0
    return await _send_confirmations(sessionmaker, mailer, settings, Grant.user_id.in_(ids), now)


async def _send_confirmations(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    which: ColumnElement[bool],
    now: datetime,
) -> int:
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                select(Grant.external_id, Grant.source, Grant.period, User.email, User.withdrew_at)
                .join(User, User.id == Grant.user_id)
                .where(which, _kept(now), _not_sent(BillingNoticeKind.CONFIRMATION))
                .order_by(Grant.created_at)
            )
        ).all()
    owed: list[_Notice] = []
    for subscription_id, source, period, email, withdrew_at in rows:
        if subscription_id is None or email is None:
            continue  # excluded by the query; narrows the types
        if period is None:
            log.info(
                "a new subscription has no billing period yet; its confirmation waits",
                extra={"subscription": subscription_id},
            )
            continue
        message = confirmation_email(
            to=email,
            source=GrantSource(source),
            period=GrantPeriod(period),
            web_origin=settings.web_origin,
            already_withdrew=withdrew_at is not None,
        )
        owed.append(_Notice(BillingNoticeKind.CONFIRMATION, subscription_id, None, message))
    return await _send_all(sessionmaker, mailer, owed, now)


async def send_renewal_reminders(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    now: datetime,
) -> int:
    """Remind each yearly subscriber whose renewal falls inside `REMINDER_WINDOW` of `now`.

    One reminder per renewal: a renewed grant's new `expires_at` makes the next one owed
    a year on.

    Returns:
        How many reminders were sent and recorded.
    """
    earliest, latest = REMINDER_WINDOW
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                select(Grant.external_id, Grant.source, Grant.expires_at, User.email)
                .join(User, User.id == Grant.user_id)
                .where(
                    _kept(now),
                    Grant.auto_renews.is_(True),
                    Grant.period == GrantPeriod.YEAR.value,
                    Grant.expires_at >= now + earliest,
                    Grant.expires_at <= now + latest,
                    _not_sent(BillingNoticeKind.RENEWAL_REMINDER, per_renewal=True),
                )
                .order_by(Grant.expires_at)
            )
        ).all()
    owed: list[_Notice] = []
    for subscription_id, source, expires_at, email in rows:
        if subscription_id is None or expires_at is None or email is None:
            continue  # excluded by the query; narrows the types
        message = renewal_reminder_email(
            to=email,
            source=GrantSource(source),
            renews_on=to_utc(expires_at).date(),
            web_origin=settings.web_origin,
        )
        owed.append(
            _Notice(BillingNoticeKind.RENEWAL_REMINDER, subscription_id, expires_at, message)
        )
    return await _send_all(sessionmaker, mailer, owed, now)


async def run_billing_notices(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    now: datetime,
) -> int:
    """Send every confirmation, renewal reminder, and withdrawal email owed at `now`.

    A withdrawal email is owed when its send after the withdrawal failed.

    Returns:
        How many notices were sent and recorded.
    """
    sent = await _send_confirmations(sessionmaker, mailer, settings, true(), now)
    sent += await send_renewal_reminders(sessionmaker, mailer, settings, now)
    return sent + await _send_withdrawals(sessionmaker, mailer, settings, now)


async def _send_withdrawals(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    settings: Settings,
    now: datetime,
) -> int:
    """Send the withdrawal email for each completed withdrawal that has none recorded."""
    async with sessionmaker() as session:
        rows = (
            await session.execute(
                select(Grant.external_id, User.email)
                .join(User, User.id == Grant.user_id)
                .where(
                    _paid(),
                    User.withdrew_at.is_not(None),
                    Grant.refunded_at.is_not(None),
                    Grant.withdrawn_at.is_not(None),
                    _not_sent(BillingNoticeKind.WITHDRAWAL),
                )
                .order_by(Grant.withdrawn_at)
            )
        ).all()
    owed: list[_Notice] = []
    for subscription_id, email in rows:
        if subscription_id is None or email is None:
            continue  # excluded by the query; narrows the types
        message = withdrawal_email(to=email, web_origin=settings.web_origin)
        owed.append(_Notice(BillingNoticeKind.WITHDRAWAL, subscription_id, None, message))
    return await _send_all(sessionmaker, mailer, owed, now)


async def _send_all(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    owed: list[_Notice],
    now: datetime,
) -> int:
    """Send and record each notice. One failure is logged and never stops the others.

    Once Resend rate limits a send, the rest wait for the next pass.
    """
    sent = 0
    for notice in owed:
        extra = {"subscription": notice.subscription_id, "kind": notice.kind.value}
        try:
            delivered = await _send(mailer, notice)
        except MailerRateLimitedError:
            log.warning("Resend rate limited billing notices; the rest wait", extra=extra)
            break
        except NoticeNotSentError:
            log.exception("sending a billing notice failed", extra=extra)
            continue
        if not delivered:
            continue
        try:
            async with sessionmaker() as session:
                await record_notice(
                    session,
                    kind=notice.kind,
                    subscription_id=notice.subscription_id,
                    period_end=notice.period_end,
                    sent_at=now,
                )
        except SQLAlchemyError:
            log.exception("could not record a sent billing notice", extra=extra)
            continue
        sent += 1
    return sent


async def _send(mailer: Mailer, notice: _Notice) -> bool:
    """Send one notice, returning only whether Resend accepted it.

    An unexpected failure is raised again as a new error that names only its type,
    outside the handler so that it chains to nothing and an error report holds no
    address or body.

    Raises:
        MailerRateLimitedError: Resend answered 429.
        NoticeNotSentError: The send failed unexpectedly.
    """
    try:
        await mailer.send(notice.message, idempotency_key=notice.key)
    except MailerRateLimitedError:
        raise
    except MailerUnavailableError:
        log.warning(
            "Resend did not accept a billing notice",
            extra={"subscription": notice.subscription_id, "kind": notice.kind.value},
        )
        return False
    except Exception as exc:  # noqa: BLE001 -- re-raised below without its frames
        failure = type(exc).__name__
    else:
        return True
    msg = f"sending a billing notice failed with {failure}"
    raise NoticeNotSentError(msg)


async def next_billing_notices_run(session: AsyncSession) -> datetime | None:
    """When the daily pass is next due, or None when it has never run."""
    return await next_run(session, BILLING_NOTICES_RUN)


async def claim_billing_notices_run(
    sessionmaker: async_sessionmaker[AsyncSession], now: datetime
) -> bool:
    """Claim the daily pass when it is due at `now`, moving its due time a day on.

    Returns:
        bool: True when this caller claimed the pass and should run it.
    """
    return await claim_run(sessionmaker, BILLING_NOTICES_RUN, now, RUN_EVERY)
