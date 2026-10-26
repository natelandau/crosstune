"""Recover a failed audio rewrite of a ready recording, shared by the trim and re-encode kinds."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.attempt import reload, retry_or_drop, still_claimed, unnamed
from crosstune.models import Job, Recording
from crosstune.storage.store import PLAYBACK_MIME, delete_best_effort, original_key

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)


async def recover_failed_audio_rewrite(
    ctx: JobContext,
    session: AsyncSession,
    job: Job,
    exc: Exception,
    *,
    orphaned: Sequence[str | None],
    release_backup: bool,
) -> None:
    """Roll back a failed trim or re-encode, record the failure, and delete its orphans.

    The recording row is never touched: it stays ready on its current files, which
    clients keep playing correctly through the seek offsets.

    Args:
        ctx: The runner's shared resources.
        session: The job's session, with the failed attempt's writes still pending.
        job: The claimed job.
        exc: What the attempt raised.
        orphaned: Files the attempt uploaded that only its rolled-back write named.
        release_backup: Whether to delete an original backup the attempt copied but
            never got to name on the row.
    """
    await session.rollback()
    stored = await reload(session, Job, job.id)
    if release_backup:
        reloaded = await release_backup_copy(ctx, session, job)
    else:
        reloaded = await reload(session, Recording, job.recording_id)
    if still_claimed(stored, job):
        await retry_or_drop(session, stored, exc)
    await session.commit()
    await ctx.delete_stale(*unnamed(reloaded, *orphaned))


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
