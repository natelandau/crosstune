"""The daily pass that warns inactive accounts and then deletes their recordings and scans.

The deletion is irreversible, so it runs only when both warnings were accepted by
Resend and recorded, counts every date from those recorded sends, and decides again
under the account's lock. An email goes out with no transaction open and no lock
held; its record is written afterwards, and only when the account still stands
where it stood when the send was decided.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, delete, exists, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from crosstune.db.base import next_server_seq
from crosstune.db.locks import lock_user
from crosstune.email.resend import MailerRateLimitedError, MailerUnavailableError
from crosstune.inactivity.emails import idempotency_key, warning_email
from crosstune.inactivity.rules import (
    FIRST_NOTICE,
    INACTIVE_AFTER,
    NoticeState,
    Step,
    deletion_due,
    next_step,
)
from crosstune.models import Grant, InactivityNotice, Recording, Scan, ScheduledRun, User
from crosstune.sync.push import cascade_delete
from crosstune.sync.tables import TABLES
from crosstune.users.clerk import ClerkUnavailableError
from crosstune.vocabulary import GrantKind

if TYPE_CHECKING:
    import uuid
    from collections.abc import Callable
    from datetime import datetime

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.email.resend import Mailer
    from crosstune.users.clerk import ClerkUsers
    from crosstune.vocabulary import TableName

log = logging.getLogger(__name__)

INACTIVITY_RUN = "inactivity"
RUN_EVERY = timedelta(days=1)
_FILE_TABLES: tuple[TableName, ...] = ("recordings", "scans")


@dataclass(frozen=True)
class Account:
    """What the rule needs to know about one account at one instant."""

    user_id: uuid.UUID
    clerk_user_id: str
    active_since: datetime
    premium: bool
    recordings: int
    scans: int
    notice: NoticeState | None

    def step(self, now: datetime) -> Step:
        """The step due for this account at `now`."""
        return next_step(
            now=now,
            active_since=self.active_since,
            premium=self.premium,
            holds_files=self.recordings + self.scans > 0,
            notice=self.notice,
        )


def _activity() -> ColumnElement[datetime]:
    return func.coalesce(User.last_synced_at, User.created_at)


def _premium(now: datetime) -> ColumnElement[bool]:
    """Match a user with a Premium grant active at `now`, with no leeway."""
    return exists().where(
        Grant.user_id == User.id,
        Grant.kind == GrantKind.PREMIUM.value,
        or_(Grant.expires_at.is_(None), Grant.expires_at > now),
    )


def _live_recordings() -> ColumnElement[bool]:
    return exists().where(Recording.user_id == User.id, Recording.deleted_at.is_(None))


def _live_scans() -> ColumnElement[bool]:
    return exists().where(Scan.user_id == User.id, Scan.deleted_at.is_(None))


async def read_account(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> Account | None:
    """Read one account's activity, Premium, live files, and stored warnings."""
    recordings = (
        select(func.count())
        .where(Recording.user_id == User.id, Recording.deleted_at.is_(None))
        .scalar_subquery()
    )
    scans = (
        select(func.count())
        .where(Scan.user_id == User.id, Scan.deleted_at.is_(None))
        .scalar_subquery()
    )
    row = (
        await session.execute(
            select(User.clerk_user_id, _activity(), _premium(now), recordings, scans).where(
                User.id == user_id
            )
        )
    ).one_or_none()
    if row is None:
        return None
    clerk_user_id, active_since, premium, recording_count, scan_count = row
    stored = await session.scalar(
        select(InactivityNotice)
        .where(InactivityNotice.user_id == user_id)
        .execution_options(populate_existing=True)
    )
    notice = (
        None
        if stored is None
        else NoticeState(
            active_since=stored.active_since,
            first_sent_at=stored.first_sent_at,
            second_sent_at=stored.second_sent_at,
            deletion_due_at=stored.deletion_due_at,
        )
    )
    return Account(
        user_id=user_id,
        clerk_user_id=clerk_user_id,
        active_since=active_since,
        premium=premium,
        recordings=recording_count,
        scans=scan_count,
        notice=notice,
    )


async def _candidates(
    sessionmaker: async_sessionmaker[AsyncSession], now: datetime
) -> list[uuid.UUID]:
    """Every account the rule might act on at `now`: warned ones and ones due a first warning."""
    due_for_first = and_(
        _activity() <= now - (INACTIVE_AFTER - FIRST_NOTICE),
        ~_premium(now),
        or_(_live_recordings(), _live_scans()),
    )
    warned = exists().where(InactivityNotice.user_id == User.id)
    async with sessionmaker() as session, session.begin():
        result = await session.scalars(
            select(User.id).where(or_(warned, due_for_first)).order_by(User.id)
        )
        return list(result)


@dataclass
class _Pass:
    """One run of the pass: its clients, the instant it decides at, and the clock it records sends by.

    `rate_limited` turns true once Resend answers 429, after which the pass sends no more warnings.
    """

    sessionmaker: async_sessionmaker[AsyncSession]
    mailer: Mailer
    clerk_users: ClerkUsers
    settings: Settings
    now: datetime
    clock: Callable[[], datetime]
    rate_limited: bool = field(default=False)


async def run_inactivity(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    clerk_users: ClerkUsers,
    settings: Settings,
    now: datetime,
    *,
    clock: Callable[[], datetime],
) -> int:
    """Take each inactive account one step: warn it, delete its files, or forget its warnings.

    Every account is judged at `now`. A warning is recorded at the instant `clock`
    reads once Resend accepted it, so a send late in a long pass counts from when it
    actually went out. Once Resend rate limits a send, the rest of the pass sends no
    warnings and still applies deletions and resets. One account's failure is logged and never stops the pass for
    the others.

    Returns:
        int: How many accounts changed.
    """
    run = _Pass(sessionmaker, mailer, clerk_users, settings, now, clock)
    changed = 0
    for user_id in await _candidates(sessionmaker, now):
        try:
            if await _advance(run, user_id):
                changed += 1
        except Exception:
            log.exception("inactivity pass failed for an account", extra={"user": str(user_id)})
    return changed


async def _advance(run: _Pass, user_id: uuid.UUID) -> bool:
    async with run.sessionmaker() as session, session.begin():
        account = await read_account(session, user_id, run.now)
    if account is None:
        return False
    step = account.step(run.now)
    if step in (Step.FIRST, Step.SECOND):
        # Skipped warnings go out on a later pass; nothing is recorded for them.
        if run.rate_limited:
            return False
        return await _warn(run, account, step)
    if step in (Step.DELETE, Step.RESET):
        return await _apply_under_lock(run.sessionmaker, user_id, step, run.now)
    return False


async def _warn(run: _Pass, account: Account, step: Step) -> bool:
    """Send the warning due, then record it if the account has not moved meanwhile."""
    # The printed date. The recorded one derives from the later send instant, and
    # deletion_due never decreases as its instant grows, so it is never earlier.
    deletion_on = deletion_due(
        now=run.now, active_since=account.active_since, notice=account.notice
    )
    if not await _send_warning(run, account, step, deletion_on):
        return False
    # Never before the decision instant, so a clock that steps back cannot record a send
    # earlier than the date the email printed.
    sent_at = max(run.clock(), run.now)
    return await _record_warning(run.sessionmaker, account, step, sent_at)


class WarningNotSentError(Exception):
    """Sending a warning failed in a way neither Clerk nor Resend reported."""


async def _send_warning(run: _Pass, account: Account, step: Step, deletion_on: datetime) -> bool:
    """Send the warning, returning only whether Resend accepted it.

    The address and the message exist only in `_deliver`'s frame, which has ended
    before anything is recorded, so an error report from the rest of the pass holds
    neither. An unexpected failure is raised again as a new error that names only its
    type, outside the handler so that it chains to nothing.

    Raises:
        WarningNotSentError: The lookup, the email, or the send failed unexpectedly.
    """
    try:
        return await _deliver(run, account, step, deletion_on)
    except Exception as exc:  # noqa: BLE001 -- re-raised below without its frames
        failure = type(exc).__name__
    msg = f"sending an inactivity warning failed with {failure}"
    raise WarningNotSentError(msg)


async def _deliver(run: _Pass, account: Account, step: Step, deletion_on: datetime) -> bool:
    """Look up the account's address in Clerk and mail it the warning."""
    extra = {"user": str(account.user_id), "step": step.value}
    try:
        clerk_user = await run.clerk_users.find_user(account.clerk_user_id)
    except ClerkUnavailableError:
        log.warning("could not look up an inactive account in Clerk", extra=extra)
        return False
    if clerk_user is None or clerk_user.email is None:
        log.warning("inactive account has no email address to warn", extra=extra)
        return False
    message = warning_email(
        to=clerk_user.email,
        step=step,
        deletion_on=deletion_on,
        last_active=account.active_since,
        recordings=account.recordings,
        scans=account.scans,
        web_origin=run.settings.web_origin,
    )
    try:
        await run.mailer.send(
            message, idempotency_key=idempotency_key(account.user_id, account.active_since, step)
        )
    except MailerRateLimitedError:
        run.rate_limited = True
        log.warning("Resend rate limited the pass; sending no more warnings in it", extra=extra)
        return False
    except MailerUnavailableError:
        log.warning("Resend did not accept an inactivity warning", extra=extra)
        return False
    return True


async def _record_warning(
    sessionmaker: async_sessionmaker[AsyncSession],
    account: Account,
    step: Step,
    sent_at: datetime,
) -> bool:
    """Record a warning Resend accepted at `sent_at`, with the deletion date that send sets.

    Records nothing when the account synced or its warnings changed since the read,
    which leaves the next pass to decide again: at worst the same warning goes out
    twice, and one that was not recorded never counts.
    """
    deletion_on = deletion_due(
        now=sent_at, active_since=account.active_since, notice=account.notice
    )
    async with sessionmaker() as session, session.begin():
        await lock_user(session, account.user_id)
        current = await read_account(session, account.user_id, sent_at)
        if (
            current is None
            or current.active_since != account.active_since
            or current.notice != account.notice
        ):
            log.info(
                "inactive account changed while its warning was sent; not recorded",
                extra={"user": str(account.user_id), "step": step.value},
            )
            return False
        if step is Step.FIRST:
            await session.execute(
                insert(InactivityNotice)
                .values(
                    user_id=account.user_id,
                    active_since=account.active_since,
                    first_sent_at=sent_at,
                    second_sent_at=None,
                    deletion_due_at=deletion_on,
                )
                .on_conflict_do_update(
                    index_elements=[InactivityNotice.user_id],
                    set_={
                        "active_since": account.active_since,
                        "first_sent_at": sent_at,
                        "second_sent_at": None,
                        "deletion_due_at": deletion_on,
                    },
                )
            )
        else:
            await session.execute(
                update(InactivityNotice)
                .where(InactivityNotice.user_id == account.user_id)
                .values(second_sent_at=sent_at, deletion_due_at=deletion_on)
            )
    return True


async def _apply_under_lock(
    sessionmaker: async_sessionmaker[AsyncSession], user_id: uuid.UUID, step: Step, now: datetime
) -> bool:
    """Delete the account's files or forget its warnings, if the rule still says so under the lock."""
    async with sessionmaker() as session, session.begin():
        await lock_user(session, user_id)
        current = await read_account(session, user_id, now)
        if current is None or current.step(now) is not step:
            return False
        if step is Step.DELETE:
            await _delete_files(session, user_id, now)
        await session.execute(delete(InactivityNotice).where(InactivityNotice.user_id == user_id))
    if step is Step.DELETE:
        log.info("deleted an inactive account's recordings and scans", extra={"user": str(user_id)})
    return True


async def _delete_files(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """Tombstone every live recording and scan, and what a client delete of each cascades to.

    Each row takes the same columns a pushed delete writes, so devices pull the deletes
    like any other, and the runner's purge removes the files.
    """
    for name in _FILE_TABLES:
        spec = TABLES[name]
        model: Any = spec.model
        deleted = list(
            await session.scalars(
                update(model)
                .where(spec.owned_by(user_id), model.deleted_at.is_(None))
                .values(deleted_at=now, updated_at=now, server_seq=next_server_seq())
                .returning(model.id)
            )
        )
        if deleted:
            await cascade_delete(session, spec, deleted, now, user_id)


async def next_inactivity_run(session: AsyncSession) -> datetime | None:
    """When the pass is next due, or None when it has never run."""
    return await session.scalar(
        select(ScheduledRun.next_run_at).where(ScheduledRun.name == INACTIVITY_RUN)
    )


async def claim_inactivity_run(
    sessionmaker: async_sessionmaker[AsyncSession], now: datetime
) -> bool:
    """Claim the pass when it is due at `now`, moving its due time a day on.

    The claim is one upsert whose update applies only while the stored time is due,
    so of several processes claiming at once exactly one wins.

    Returns:
        bool: True when this caller claimed the pass and should run it.
    """
    next_run_at = now + RUN_EVERY
    async with sessionmaker() as session, session.begin():
        claimed = await session.scalar(
            insert(ScheduledRun)
            .values(name=INACTIVITY_RUN, next_run_at=next_run_at)
            .on_conflict_do_update(
                index_elements=[ScheduledRun.name],
                set_={"next_run_at": next_run_at},
                where=ScheduledRun.next_run_at <= now,
            )
            .returning(ScheduledRun.name)
        )
    return claimed is not None
