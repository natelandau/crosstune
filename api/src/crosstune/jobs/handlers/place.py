"""Name a recording's coordinates through Apple Maps."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.jobs.attempt import (
    LAST_ERROR_CHARS,
    RETRY_BACKOFF_SECONDS,
    attempt_timeout,
    load_claimed,
    load_locked,
    reload,
    retry_or_drop,
    still_claimed,
)
from crosstune.models import Job, Recording
from crosstune.places.maps import MapsBusyError, MapsError
from crosstune.recordings.service import ensure_place_job

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext

log = logging.getLogger(__name__)

# Apple Maps being down or unconfigured is no fault of the coordinates, so the job
# outlasts it rather than leaving a place unnamed for good: each wait is as long as the
# job has waited so far, so the waits double, up to the cap.
NAMING_BACKOFF_CAP = timedelta(hours=6)
NAMING_GIVE_UP_AFTER = timedelta(days=7)


def _nothing_to_name(recording: Recording) -> bool:
    return (
        recording.deleted_at is not None
        or recording.place_lat is None
        or recording.place_lon is None
        or recording.place_name is not None
    )


async def run(ctx: JobContext, job: Job) -> None:
    """Name the recording's coordinates, unless they or their name changed meanwhile.

    The lookup runs with no transaction open and no lock held, so the user's pushes
    never wait on Apple Maps. An Apple Maps failure, a timeout, or a server with no Maps
    key spends no attempt and holds the job back until NAMING_GIVE_UP_AFTER.
    """
    async with ctx.sessionmaker() as session:
        async with session.begin():
            prepared = await load_claimed(session, job, done=_nothing_to_name)
            if prepared is None:
                return
            recording, stored_job = prepared
            lat, lon = recording.place_lat, recording.place_lon
            if lat is None or lon is None:
                await session.delete(stored_job)
                return
            if ctx.maps is None or ctx.http_client is None:
                await _wait_for_maps(session, stored_job, "Apple Maps is not configured")
                return
        try:
            async with attempt_timeout():
                name = await ctx.maps.reverse_name(
                    ctx.http_client, lat, lon, timeout=ctx.settings.link_resolve_timeout_seconds
                )
        except Exception as exc:  # noqa: BLE001 -- any lookup failure is a job failure, not a crash
            async with session.begin():
                await _lookup_failed(session, job, exc)
            return
        async with session.begin():
            locked = await load_locked(session, job)
            if locked is None:
                return
            current, stored_job = locked
            await session.delete(stored_job)
            if (current.place_lat, current.place_lon) != (lat, lon):
                # New coordinates pushed during the lookup need a lookup of their own.
                await ensure_place_job(session, current)
            elif name and current.place_name is None:
                current.place_name = name
                bump_server_seq(current)


async def _lookup_failed(session: AsyncSession, job: Job, exc: Exception) -> None:
    """Wait out a transient Apple Maps failure or a timeout; retry anything else as any job would."""
    stored = await reload(session, Job, job.id)
    if not still_claimed(stored, job):
        return
    if not (isinstance(exc, TimeoutError) or (isinstance(exc, MapsError) and exc.transient)):
        await retry_or_drop(session, stored, exc)
        return
    log.warning(
        "place lookup failed", extra={"recording": str(job.recording_id), "error": str(exc)}
    )
    if await _wait_for_maps(session, stored, str(exc) or type(exc).__name__):
        _wait_out_busy(stored, exc)


async def _wait_for_maps(session: AsyncSession, job: Job, reason: str) -> bool:
    """Hold the job back without spending an attempt, or drop it once it has waited too long.

    Returns:
        bool: Whether the job is still queued.
    """
    waited = utc_now() - job.created_at
    if waited >= NAMING_GIVE_UP_AFTER:
        log.warning("place gave up", extra={"recording": str(job.recording_id), "error": reason})
        await session.delete(job)
        return False
    job.attempts -= 1
    job.last_error = reason[:LAST_ERROR_CHARS]
    delay = min(max(waited, timedelta(seconds=RETRY_BACKOFF_SECONDS)), NAMING_BACKOFF_CAP)
    job.locked_until = utc_now() + delay
    return True


def _wait_out_busy(job: Job, exc: Exception) -> None:
    """Hold a rate-limited job back at least as long as Apple Maps asked."""
    if not isinstance(exc, MapsBusyError):
        return
    asked = utc_now() + timedelta(seconds=exc.retry_after_seconds)
    if job.locked_until is None or job.locked_until < asked:
        job.locked_until = asked
