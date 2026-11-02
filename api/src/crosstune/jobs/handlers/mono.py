"""Measure whether a recording's playback file is mono."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq
from crosstune.jobs.attempt import (
    attempt_timeout,
    load_claimed,
    load_locked,
    reload,
    retry_or_drop,
    still_claimed,
)
from crosstune.jobs.mono import measure_mono
from crosstune.models import Job

if TYPE_CHECKING:
    from crosstune.jobs.attempt import JobContext
    from crosstune.models import Recording


def _nothing_to_measure(recording: Recording) -> bool:
    return recording.deleted_at is not None or recording.is_mono is not None


async def run(ctx: JobContext, job: Job) -> None:
    """Set the recording's mono flag from its playback file, unless a device set it meanwhile.

    The download and the measurement run with no transaction open and no lock held, so
    the user's pushes never wait on ffmpeg.
    """
    async with ctx.sessionmaker() as session:
        async with session.begin():
            prepared = await load_claimed(session, job, done=_nothing_to_measure)
            if prepared is None:
                return
            recording, stored_job = prepared
            playback_key = recording.playback_key
            if playback_key is None:
                await session.delete(stored_job)
                return
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    source = Path(folder) / "playback.m4a"
                    await ctx.store.download(playback_key, source)
                    is_mono = await measure_mono(source)
            except Exception as exc:  # noqa: BLE001 -- any failure here is a job failure, not a crash
                async with session.begin():
                    stored = await reload(session, Job, job.id)
                    if still_claimed(stored, job):
                        await retry_or_drop(session, stored, exc)
                return
        async with session.begin():
            locked = await load_locked(session, job)
            if locked is None:
                return
            current, stored_job = locked
            await session.delete(stored_job)
            if current.is_mono is None:
                current.is_mono = is_mono
                bump_server_seq(current)
