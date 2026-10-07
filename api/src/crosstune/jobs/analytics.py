"""Delete a deleted account's PostHog person, retried, and again after each delay.

PostHog deletes only the events it has captured when the delete arrives, so later
passes catch events a client sent just before the account went, and events a device
that was offline queued and uploads hours or days later.
"""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import func, or_, select

from crosstune.analytics.posthog import AnalyticsUnavailableError
from crosstune.db.base import utc_now
from crosstune.models import AnalyticsDeletion

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.analytics.posthog import AnalyticsPersons

log = logging.getLogger(__name__)

# Outlasts the PostHog client's request timeout, so a claim never expires under a pass
# still waiting on its answer.
LOCK_SECONDS = 120
MAX_ATTEMPTS = 5
# An outage at PostHog lasts minutes, not seconds, so retries wait longer than a job's.
RETRY_BACKOFF_SECONDS = 300
LAST_ERROR_CHARS = 500


def schedule_person_deletion(
    session: AsyncSession, distinct_id: str, *, later_passes_after: Sequence[timedelta]
) -> None:
    """Queue a delete of the person now and another after each of `later_passes_after`.

    Added to the caller's transaction, so the deletes commit with the account deletion
    and a rolled-back deletion queues nothing.
    """
    now = utc_now()
    session.add(AnalyticsDeletion(distinct_id=distinct_id, attempts=0, created_at=now))
    session.add_all(
        AnalyticsDeletion(
            distinct_id=distinct_id, attempts=0, locked_until=now + delay, created_at=now
        )
        for delay in later_passes_after
    )


async def next_due(session: AsyncSession) -> datetime | None:
    """When the earliest held-back pass becomes due, or None when none is waiting."""
    return await session.scalar(select(func.min(AnalyticsDeletion.locked_until)))


async def delete_due_person(
    sessionmaker: async_sessionmaker[AsyncSession], persons: AnalyticsPersons
) -> int:
    """Run one due pass: delete its person, or hold it back for a retry.

    Returns:
        int: 1 when a pass ran, else 0, so the runner knows whether to sleep.
    """
    claimed = await _claim(sessionmaker)
    if claimed is None:
        return 0
    try:
        await persons.delete_person(claimed.distinct_id)
    except AnalyticsUnavailableError as exc:
        await _fail(sessionmaker, claimed, exc)
        return 1
    async with sessionmaker() as session, session.begin():
        stored = await session.get(AnalyticsDeletion, claimed.id)
        if stored is not None and stored.locked_until == claimed.locked_until:
            await session.delete(stored)
    return 1


async def _claim(sessionmaker: async_sessionmaker[AsyncSession]) -> AnalyticsDeletion | None:
    """Lock the oldest due pass, dropping one whose every attempt ended without an outcome."""
    now = utc_now()
    async with sessionmaker() as session, session.begin():
        pending = await session.scalar(
            select(AnalyticsDeletion)
            .where(
                or_(AnalyticsDeletion.locked_until.is_(None), AnalyticsDeletion.locked_until < now)
            )
            .order_by(AnalyticsDeletion.created_at)
            .limit(1)
            .with_for_update(skip_locked=True)
        )
        if pending is None:
            return None
        if pending.attempts >= MAX_ATTEMPTS:
            log.error(
                "gave up deleting an analytics person after attempts that never finished",
                extra={"person": pending.distinct_id, "attempt": pending.attempts},
            )
            await session.delete(pending)
            return None
        pending.attempts += 1
        pending.locked_until = now + timedelta(seconds=LOCK_SECONDS)
        await session.flush()
        session.expunge(pending)
        return pending


async def _fail(
    sessionmaker: async_sessionmaker[AsyncSession],
    claimed: AnalyticsDeletion,
    exc: AnalyticsUnavailableError,
) -> None:
    """Drop the pass on its last attempt, else hold it back for a retry."""
    extra = {"person": claimed.distinct_id, "attempt": claimed.attempts, "error": str(exc)}
    async with sessionmaker() as session, session.begin():
        stored = await session.get(AnalyticsDeletion, claimed.id)
        if stored is None or stored.locked_until != claimed.locked_until:
            return
        if stored.attempts >= MAX_ATTEMPTS:
            log.error("gave up deleting an analytics person", exc_info=exc, extra=extra)
            await session.delete(stored)
            return
        log.warning("could not delete an analytics person; will retry", extra=extra)
        stored.last_error = str(exc)[:LAST_ERROR_CHARS]
        stored.locked_until = utc_now() + timedelta(seconds=RETRY_BACKOFF_SECONDS * stored.attempts)
