"""Build a recording's waveform peaks without moving it through processing."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.jobs.attempt import (
    attempt_timeout,
    changed,
    load_claimed,
    reload,
    retry_or_drop,
    still_claimed,
)
from crosstune.jobs.peaks_job import build_recording_peaks
from crosstune.models import Job, Recording
from crosstune.recordings.service import ensure_trim_job

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext


async def run(ctx: JobContext, job: Job) -> None:
    """Build one recording's waveform peaks, never moving it through processing."""
    async with ctx.sessionmaker() as session:
        prepared = await _prepare(session, job)
        if prepared is None:
            return
        recording, stored_job = prepared
        previous_peaks_key = recording.peaks_key
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    await build_recording_peaks(session, ctx.store, recording, Path(folder))
            except Exception as exc:  # noqa: BLE001 -- any failure here is a job failure, not a crash
                await session.rollback()
                reloaded = await reload(session, Recording, job.recording_id)
                stored = await reload(session, Job, job.id)
                # The recording row is never touched: it keeps playing without peaks.
                if reloaded is not None and still_claimed(stored, job):
                    await retry_or_drop(session, stored, exc)
                await session.commit()
                return
        # build_recording_peaks() holds the user's lock past its own return; a trim
        # pushed while this job ran is only visible to ensure_trim_job read fresh now.
        await session.refresh(recording, attribute_names=["trim_start_ms", "trim_end_ms"])
        await session.delete(stored_job)
        await ensure_trim_job(session, recording)
        await session.commit()
        stale_peaks_key = changed(previous_peaks_key, recording.peaks_key)
    await ctx.delete_stale(stale_peaks_key)


async def _prepare(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Load the row pair for a peaks job. Never marks the recording processing.

    Returns:
        tuple[Recording, Job] | None: The loaded pair, or None when there is
        nothing left to build: the row is gone, already soft-deleted, has no
        playback file to draw peaks from, or another claimer has since
        re-locked the job past our own claim.
    """
    async with session.begin():
        # Nothing to build peaks from, now or on a retry; only a transcode or trim
        # job ever sets a playback file, so waiting won't help this job.
        return await load_claimed(
            session,
            job,
            done=lambda recording: (
                recording.deleted_at is not None or recording.playback_key is None
            ),
        )
