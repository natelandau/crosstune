"""Turn an upload into the recording's playback and peaks files."""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq
from crosstune.db.locks import lock_user
from crosstune.jobs.attempt import (
    attempt_timeout,
    changed,
    fail_recording,
    load_claimed,
    reload,
    still_claimed,
    unnamed,
)
from crosstune.jobs.transcode import transcode
from crosstune.models import Job, Recording
from crosstune.recordings.service import ensure_trim_job
from crosstune.storage.store import upload_key

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)


async def run(ctx: JobContext, job: Job) -> None:
    """Run one job to completion, committing the setup and the outcome separately.

    transcode() issues no database statement until its own final flush, so
    the download, ffprobe, and ffmpeg work below runs with no transaction
    open and no lock held on the recording row: an API request against
    that row is never blocked for the length of a transcode.
    """
    async with ctx.sessionmaker() as session:
        prepared = await _prepare(session, job)
        if prepared is None:
            return
        recording, stored_job = prepared
        source_key = upload_key(recording.user_id, recording.id)
        previous_playback_key = recording.playback_key
        previous_peaks_key = recording.peaks_key
        committing = False
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    await transcode(session, ctx.store, recording, Path(folder))
                await session.delete(stored_job)
                await ensure_trim_job(session, recording)
                committing = True
                await session.commit()
            except asyncio.CancelledError:
                # A commit the cancel interrupted may have landed and named these,
                # so only files uploaded before it are deleted; the sweep gets the rest.
                if not committing:
                    await ctx.delete_stale(
                        changed(recording.playback_key, previous_playback_key),
                        changed(recording.peaks_key, previous_peaks_key),
                    )
                raise
            except Exception as exc:  # noqa: BLE001 -- any transcode failure is a job failure, not a crash
                # Whatever this attempt itself uploaded before failing is an
                # orphan once the rollback below discards the row's write.
                orphaned_playback_key = changed(recording.playback_key, previous_playback_key)
                orphaned_peaks_key = changed(recording.peaks_key, previous_peaks_key)
                # Roll back whatever transcode() flushed before failing, then
                # reload so the failure state is written on top of clean data.
                await session.rollback()
                reloaded = await reload(session, Recording, job.recording_id)
                stored = await reload(session, Job, job.id)
                if reloaded is not None and still_claimed(stored, job):
                    await fail_recording(session, stored, reloaded, exc)
                await session.commit()
                await ctx.delete_stale(
                    *unnamed(reloaded, orphaned_playback_key, orphaned_peaks_key)
                )
                return
        stale_playback_key = changed(previous_playback_key, recording.playback_key)
        stale_peaks_key = changed(previous_peaks_key, recording.peaks_key)
    try:
        # The upload is redundant only once the committed row points at the
        # playback file and, when needed, the original; a failure here must not
        # turn a finished recording into a failed one. The purge sweep and the
        # next retry's overwrite bound the leak.
        await ctx.store.delete(source_key)
    except Exception:  # noqa: BLE001 -- a leftover upload object is bounded, not a job failure
        log.warning(
            "could not delete the finished upload", extra={"recording": str(job.recording_id)}
        )
    await ctx.delete_stale(stale_playback_key, stale_peaks_key)


async def _prepare(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Load the row pair, mark the recording processing, and commit that alone.

    Returns:
        tuple[Recording, Job] | None: The loaded pair, or None when there is
        nothing left to transcode: the row is gone, already soft-deleted, or
        another claimer has since re-locked the job past our own claim.
    """
    async with session.begin():
        # The purge sweep owns a deleted recording's files; nothing to transcode.
        prepared = await load_claimed(
            session, job, done=lambda recording: recording.deleted_at is not None
        )
        if prepared is None:
            return None
        recording, _ = prepared
        # Every server_seq the runner draws is taken under the user's lock, like a
        # push: a seq drawn outside it can commit after a higher one, and a pull
        # cursor that has passed it never returns.
        await lock_user(session, recording.user_id)
        recording.state = "processing"
        bump_server_seq(recording)
    return prepared
