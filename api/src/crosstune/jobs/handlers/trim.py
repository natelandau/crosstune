"""Rewrite a ready recording's playback file to its saved trim."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.jobs.attempt import attempt_timeout, load_locked
from crosstune.jobs.recovery import Orphans, recover_failed_audio_rewrite, release_cancelled
from crosstune.jobs.trim import trim
from crosstune.recordings.service import ensure_trim_job
from crosstune.recordings.split_rules import split_holds_original
from crosstune.recordings.trim_rules import needs_trim

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext
    from crosstune.models import Job, Recording


async def run(ctx: JobContext, job: Job) -> None:
    """Rewrite one recording's playback file to its saved trim, never leaving ready.

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
                await release_cancelled(ctx, session, job)
                raise
            except Exception as exc:  # noqa: BLE001 -- any trim failure is a job failure, not a crash
                # trim() deletes its own uploads when it raises; these are only set
                # once it has returned and something after it failed.
                orphaned = [
                    key
                    for key in (recording.playback_key, recording.peaks_key)
                    if key not in (None, previous_playback_key, previous_peaks_key)
                ]
                await recover_failed_audio_rewrite(
                    ctx, session, job, exc, orphaned=Orphans(orphaned), release_backup=True
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
        # Read under the user's lock, so a piece pushed meanwhile is seen before the hold is.
        loaded = await load_locked(session, job)
        if loaded is None:
            return None
        recording, stored_job = loaded
        # A row that already matches has nothing to cut, and a waiting piece still needs
        # the original; a later trim queues a new job.
        if not needs_trim(recording) or await split_holds_original(session, recording):
            await session.delete(stored_job)
            return None
        return loaded
