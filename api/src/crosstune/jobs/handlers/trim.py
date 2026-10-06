"""Re-cut a ready recording's playback file to its saved trim, and recover a failed re-cut."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.attempt import (
    RELEASE_TIMEOUT_SECONDS,
    attempt_timeout,
    load_claimed,
    reload,
    retry_or_drop,
    still_claimed,
    unnamed,
)
from crosstune.jobs.trim import trim
from crosstune.models import Job, Recording
from crosstune.recordings.service import ensure_trim_job
from crosstune.recordings.trim import needs_trim
from crosstune.storage.store import PLAYBACK_MIME, delete_best_effort, original_key

if TYPE_CHECKING:
    from collections.abc import Sequence

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)


async def run(ctx: JobContext, job: Job) -> None:
    """Re-cut one recording's playback file to its saved trim, never leaving ready.

    Like a transcode, the download and ffmpeg work run with no transaction open.
    The superseded files are deleted only after the commit that stops pointing at
    them, so a failure anywhere before it leaves the recording playing as before.
    """
    async with ctx.sessionmaker() as session:
        prepared = await _prepare(session, job)
        if prepared is None:
            return
        recording, stored_job = prepared
        previous_playback_key = recording.playback_key
        previous_peaks_key = recording.peaks_key
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    superseded = await trim(session, ctx.store, recording, Path(folder))
                await session.delete(stored_job)
                # trim() read the trim columns fresh under the lock, so a trim saved
                # while it ran, which found this job holding the one trim slot, is
                # queued now.
                await ensure_trim_job(session, recording)
                await session.commit()
            except asyncio.CancelledError:
                await _release_cancelled_backup(ctx, session, job)
                raise
            except Exception as exc:  # noqa: BLE001 -- any trim failure is a job failure, not a crash
                # trim() deletes its own uploads when it raises; these are only set
                # once it has returned and something after it failed.
                orphaned = [
                    key
                    for key in (recording.playback_key, recording.peaks_key)
                    if key not in (None, previous_playback_key, previous_peaks_key)
                ]
                await recover_failed_recut(
                    ctx, session, job, exc, orphaned=orphaned, release_backup=True
                )
                return
    await ctx.delete_stale(*superseded)


async def _prepare(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Load the row pair for a trim job. Never marks the recording processing.

    Returns:
        tuple[Recording, Job] | None: The loaded pair, or None when there is
        nothing left to cut: the row is gone, soft-deleted, already matches its
        trim, or another claimer has since re-locked the job past our own claim.
    """
    async with session.begin():
        # The purge sweep owns a deleted recording's files, and a row that already
        # matches has nothing to cut; a later trim queues a new job.
        return await load_claimed(
            session,
            job,
            done=lambda recording: recording.deleted_at is not None or not needs_trim(recording),
        )


async def recover_failed_recut(
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


async def _release_cancelled_backup(ctx: JobContext, session: AsyncSession, job: Job) -> None:
    """Delete the backup a cancelled trim copied but never named, within a short budget.

    The released job may find nothing left to cut when it is retried, and then no
    attempt would ever come back for the backup.
    """
    try:
        async with asyncio.timeout(RELEASE_TIMEOUT_SECONDS):
            await session.rollback()
            await release_backup_copy(ctx, session, job)
            await session.commit()
    except Exception:  # noqa: BLE001 -- the recording's purge still removes it
        log.warning(
            "could not release a cancelled trim's backup",
            extra={"recording": str(job.recording_id)},
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
