"""Re-cut a ready recording's playback file from its original at the current rate."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.jobs.attempt import attempt_timeout, changed, load_claimed
from crosstune.jobs.handlers.trim import recover_failed_recut
from crosstune.jobs.reencode import reencode

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext
    from crosstune.models import Job, Recording


async def run(ctx: JobContext, job: Job) -> None:
    """Re-cut one recording's playback file from its original, never leaving ready.

    Like a trim, the download and ffmpeg work run with no transaction open, and the
    superseded file is deleted only after the commit that stops pointing at it.
    """
    async with ctx.sessionmaker() as session:
        prepared = await _prepare(session, job)
        if prepared is None:
            return
        recording, stored_job = prepared
        previous_playback_key = recording.playback_key
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    replacement = await reencode(session, ctx.store, recording, Path(folder))
                await session.delete(stored_job)
                await session.commit()
            except Exception as exc:  # noqa: BLE001 -- any re-encode failure is a job failure, not a crash
                # reencode() deletes its own upload when it raises; this is only set
                # once it has returned and something after it failed.
                orphaned = changed(recording.playback_key, previous_playback_key)
                await recover_failed_recut(
                    ctx, session, job, exc, orphaned=[orphaned], release_backup=False
                )
                return
    if replacement is not None:
        replacement.log_committed()
        await ctx.delete_stale(replacement.superseded_key)


async def _prepare(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Load the row pair for a re-encode job. Never marks the recording processing.

    Returns:
        tuple[Recording, Job] | None: The loaded pair, or None when there is
        nothing to re-cut: the row is gone, soft-deleted, not ready, has no
        original or no complete playback range, or another claimer has since
        re-locked the job past our own claim.
    """
    async with session.begin():
        # None of these shapes changes on a retry; a transcode that later readies the
        # row already encodes at the current rate.
        return await load_claimed(
            session,
            job,
            done=lambda recording: (
                recording.deleted_at is not None
                or recording.state != "ready"
                or recording.original_key is None
                or recording.playback_key is None
                or recording.playback_start_ms is None
                or recording.playback_end_ms is None
            ),
        )
