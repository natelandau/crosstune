"""Recover a failed audio rewrite of a ready recording, shared by the trim, re-encode, and split kinds."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.attempt import (
    RELEASE_TIMEOUT_SECONDS,
    reload,
    retry_or_drop,
    still_claimed,
    unnamed,
)
from crosstune.models import Job, Recording
from crosstune.storage.store import PLAYBACK_MIME, delete_best_effort, original_key

if TYPE_CHECKING:
    import uuid
    from collections.abc import Awaitable, Callable, Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class Orphans:
    """Files a failed attempt uploaded that only its rolled-back write named."""

    keys: Sequence[str | None] = ()
    # The row they were meant for, when it is not the job's recording.
    owner_id: uuid.UUID | None = None


async def recover_failed_audio_rewrite(
    ctx: JobContext,
    session: AsyncSession,
    job: Job,
    exc: Exception,
    *,
    orphaned: Orphans,
    release_backup: bool,
    on_final_failure: Callable[[AsyncSession, Recording], Awaitable[object]] | None = None,
) -> None:
    """Roll back a failed rewrite, record the failure, and delete its orphans.

    The job's recording stays ready on its current files, which clients keep playing
    correctly through the seek offsets.

    Args:
        ctx: The runner's shared resources.
        session: The job's session, with the failed attempt's writes still pending.
        job: The claimed job.
        exc: What the attempt raised.
        orphaned: Files the attempt uploaded that only its rolled-back write named.
        release_backup: Whether to delete an original backup the attempt copied but
            never got to name on the row.
        on_final_failure: Called with the job's recording, in the same transaction, when
            this was the job's last attempt.
    """
    await session.rollback()
    stored = await reload(session, Job, job.id)
    if release_backup:
        reloaded = await release_backup_copy(ctx, session, job)
    else:
        reloaded = await reload(session, Recording, job.recording_id)
    if (
        still_claimed(stored, job)
        and await retry_or_drop(session, stored, exc)
        and reloaded is not None
        and on_final_failure is not None
    ):
        await on_final_failure(session, reloaded)
    owner = await _orphans_owner(session, job, reloaded, orphaned)
    await session.commit()
    await ctx.delete_stale(*unnamed(owner, *orphaned.keys))


async def _orphans_owner(
    session: AsyncSession, job: Job, reloaded: Recording | None, orphaned: Orphans
) -> Recording | None:
    """The row the orphaned files were meant for, as stored now."""
    if orphaned.owner_id is None or orphaned.owner_id == job.recording_id:
        return reloaded
    # A commit that raised can still have landed; only the reloaded row knows.
    return await reload(session, Recording, orphaned.owner_id)


async def release_cancelled(
    ctx: JobContext,
    session: AsyncSession,
    job: Job,
    orphaned: Orphans | None = None,
) -> None:
    """Delete what a cancelled rewrite copied or uploaded but never named, within a short budget.

    The released job may find nothing left to do when it is retried, and then no
    attempt would ever come back for these files.

    Args:
        ctx: The runner's shared resources.
        session: The job's session, with the cancelled attempt's writes still pending.
        job: The claimed job.
        orphaned: Files the attempt uploaded that only its rolled-back write named.
    """
    orphaned = orphaned or Orphans()
    try:
        async with asyncio.timeout(RELEASE_TIMEOUT_SECONDS):
            await session.rollback()
            reloaded = await release_backup_copy(ctx, session, job)
            owner = await _orphans_owner(session, job, reloaded, orphaned)
            await session.commit()
            await ctx.delete_stale(*unnamed(owner, *orphaned.keys))
    except Exception:  # noqa: BLE001 -- the recording's purge still removes them
        log.warning(
            "could not release a cancelled job's files",
            extra={"recording": str(job.recording_id), "kind": job.kind},
        )


async def release_backup_copy(ctx: JobContext, session: AsyncSession, job: Job) -> Recording | None:
    """Delete an original a failed trim copied but never got to name on the row.

    Runs under the user's lock, where `trim` checks its backup still exists
    before committing it, so this never removes an original some row names. Also
    the trim kind's abandon hook, for a trim whose attempts all ended without a
    recorded outcome.

    Returns:
        Recording | None: The row as reloaded under the lock, or None once it is gone,
        when the purge sweep owns its whole prefix.
    """
    # After a rollback the row is expired, so its ids come from the job.
    await lock_user(session, job.user_id)
    recording = await reload(session, Recording, job.recording_id)
    if recording is None or recording.original_key is not None:
        return recording
    await delete_best_effort(
        ctx.store,
        [original_key(job.user_id, job.recording_id, PLAYBACK_MIME)],
        log=log,
        message="could not delete an unkept original backup",
    )
    return recording
