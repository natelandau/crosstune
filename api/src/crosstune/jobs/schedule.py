"""Claims for named periodic passes, so of several processes exactly one runs each."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from crosstune.models import ScheduledRun

if TYPE_CHECKING:
    from datetime import datetime, timedelta

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker


async def next_run(session: AsyncSession, name: str) -> datetime | None:
    """When the named pass is next due, or None when it has never run."""
    return await session.scalar(select(ScheduledRun.next_run_at).where(ScheduledRun.name == name))


async def claim_run(
    sessionmaker: async_sessionmaker[AsyncSession], name: str, now: datetime, every: timedelta
) -> bool:
    """Claim the named pass when it is due at `now`, moving its due time `every` on.

    The claim is one upsert whose update applies only while the stored time is due,
    so of several processes claiming at once exactly one wins.

    Returns:
        bool: True when this caller claimed the pass and should run it.
    """
    next_run_at = now + every
    async with sessionmaker() as session, session.begin():
        claimed = await session.scalar(
            insert(ScheduledRun)
            .values(name=name, next_run_at=next_run_at)
            .on_conflict_do_update(
                index_elements=[ScheduledRun.name],
                set_={"next_run_at": next_run_at},
                where=ScheduledRun.next_run_at <= now,
            )
            .returning(ScheduledRun.name)
        )
    return claimed is not None
