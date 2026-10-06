"""What every job attempt shares: its time limits, its claim checks, and its retry policy."""

from __future__ import annotations

import asyncio
import logging
import tempfile
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING, TypeGuard

import httpx2
from botocore.exceptions import BotoCoreError, ClientError

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.locks import lock_user
from crosstune.http import BlockedAddressError
from crosstune.jobs.importer import UNREACHABLE
from crosstune.jobs.media import SUBPROCESS_TIMEOUT_SECONDS, MediaError
from crosstune.models import Job, Recording
from crosstune.storage.store import delete_best_effort

if TYPE_CHECKING:
    import uuid
    from collections.abc import Callable
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
# The longest job attempt is a transcode that needs a cut: five ffmpeg-family runs
# (probe, remux, cut, probe, peaks), each capped at SUBPROCESS_TIMEOUT_SECONDS, plus
# the bucket transfers of a file the upload limit keeps to 50 MB. An attempt still
# running at this limit fails like any other error and is retried.
ATTEMPT_TIMEOUT_SECONDS = 5 * SUBPROCESS_TIMEOUT_SECONDS + 300
# Outlasts any attempt, so a claim never expires under one still running, and with it
# the window in which a job may name a file it uploaded.
LOCK_SECONDS = ATTEMPT_TIMEOUT_SECONDS + 300
# How long a cancelled job may spend handing its claim back before shutdown goes on.
RELEASE_TIMEOUT_SECONDS = 3.0
# Each failed attempt holds its job back this much longer than the last.
RETRY_BACKOFF_SECONDS = 30
# How much of a raw failure the job row keeps for diagnosis.
LAST_ERROR_CHARS = 500
# What a client shows for a failure the server has no better phrase for.
PROCESSING_FAILED = "Processing failed"

_STORAGE_ERRORS = (BotoCoreError, ClientError)


@dataclass(frozen=True)
class JobContext:
    """The runner's shared resources, handed to every job handler."""

    sessionmaker: async_sessionmaker[AsyncSession]
    store: ObjectStore
    settings: Settings
    work_root: Path | None = None
    http_client: httpx2.AsyncClient | None = None

    def work_dir(self) -> tempfile.TemporaryDirectory[str]:
        """A scratch folder for one attempt, removed when the attempt ends."""
        return tempfile.TemporaryDirectory(dir=self.work_root)

    async def delete_stale(self, *keys: str | None) -> None:
        """Best-effort delete of objects a job's own write superseded or orphaned.

        Never called with an original key: the original is never deleted, since a
        retry or a later job only ever overwrites it in place.
        """
        await delete_best_effort(
            self.store, keys, log=log, message="could not delete a superseded object"
        )


def attempt_timeout() -> asyncio.Timeout:
    """The time limit one attempt's work runs under."""
    return asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS)


def changed(key: str | None, other: str | None) -> str | None:
    """`key` when it names a file `other` does not, else None."""
    return key if key not in (None, other) else None


def unnamed(recording: Recording | None, *keys: str | None) -> list[str | None]:
    """Drop any key the reloaded row still names, so a failure never deletes a live file.

    A commit that raises can still have landed; only the reloaded row knows. A row that is
    gone names nothing, and the purge sweep owns its prefix anyway.
    """
    if recording is None:
        return list(keys)
    named = {recording.playback_key, recording.peaks_key, recording.original_key}
    return [key for key in keys if key not in named]


def still_claimed(stored_job: Job | None, claimed: Job) -> TypeGuard[Job]:
    """Whether a failing attempt may still write its job row.

    An attempt that outran LOCK_SECONDS can be claimed again by another pass, which owns
    the job row, and its recording's state, from then on. That pass may already have
    finished and deleted the row, as may this attempt's own commit that raised after landing.
    """
    return stored_job is not None and stored_job.locked_until == claimed.locked_until


async def reload[T](session: AsyncSession, model: type[T], key: uuid.UUID) -> T | None:
    """Re-read a row after a rollback, or None when it no longer exists.

    `session.refresh` raises on a row deleted since it was loaded, which a reclaimed job or
    a purged recording can be by the time a failing attempt looks again.
    """
    return await session.get(model, key, populate_existing=True)


async def load_claimed(
    session: AsyncSession, job: Job, *, done: Callable[[Recording], bool]
) -> tuple[Recording, Job] | None:
    """Load a claimed job's row pair, or None when this claim has nothing left to do.

    Called inside the caller's transaction. A job whose recording `done` says needs no
    work, now or on a retry, is deleted. A claim that another pass has since re-locked,
    after this attempt outran LOCK_SECONDS, leaves the job alone.
    """
    recording = await session.get(Recording, job.recording_id)
    stored_job = await session.get(Job, job.id)
    if recording is None or not still_claimed(stored_job, job):
        return None
    if done(recording):
        await session.delete(stored_job)
        return None
    return recording, stored_job


async def load_locked(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Take the job's user lock and re-read its row pair fresh, as `load_claimed` does.

    Re-read rather than taken from the identity map, since the rows may have changed
    while the job worked with no transaction open.
    """
    await lock_user(session, job.user_id)
    current = await reload(session, Recording, job.recording_id)
    stored_job = await reload(session, Job, job.id)
    if current is None or not still_claimed(stored_job, job):
        return None
    if current.deleted_at is not None:
        await session.delete(stored_job)
        return None
    return current, stored_job


def client_message(exc: Exception) -> str:
    """A short, safe description of a failure for the recording row.

    Args:
        exc: Whatever the attempt raised.

    Returns:
        str: Text a client can show. Raw exception text stays in the log and the job.
    """
    if isinstance(exc, MediaError):
        return "The audio could not be read"
    if isinstance(exc, _STORAGE_ERRORS):
        return "Storage was unavailable"
    if isinstance(exc, (httpx2.HTTPError, BlockedAddressError)):
        return UNREACHABLE
    return PROCESSING_FAILED


async def retry_or_drop(session: AsyncSession, job: Job, exc: Exception) -> bool:
    """Drop the job on its last attempt, else hold it back for a retry.

    The give-up is logged with its traceback, since a code error and a bad file look
    the same from the job row alone.

    Args:
        session: The session to write through, in the caller's transaction.
        job: The claimed job, as stored.
        exc: What the attempt raised.

    Returns:
        bool: Whether the job was dropped.
    """
    raw = str(exc)
    extra = {"recording": str(job.recording_id), "kind": job.kind, "attempt": job.attempts}
    if job.attempts >= MAX_ATTEMPTS:
        log.error("%s gave up", job.kind, exc_info=exc, extra=extra)
        await session.delete(job)
        return True
    log.warning("job failed", extra={**extra, "error": raw})
    job.last_error = raw[:LAST_ERROR_CHARS]
    job.locked_until = utc_now() + timedelta(seconds=RETRY_BACKOFF_SECONDS * job.attempts)
    return False


async def fail_recording(
    session: AsyncSession,
    job: Job,
    recording: Recording,
    exc: Exception,
    *,
    retry_state: str = "uploaded",
) -> None:
    """Fail the recording on the last attempt, else hold the job back for a retry.

    Args:
        session: The session to write through, in the caller's transaction.
        job: The claimed job.
        recording: The job's recording.
        exc: What the attempt raised.
        retry_state: The recording's state while it waits for the retry.
    """
    await lock_user(session, recording.user_id)
    if await retry_or_drop(session, job, exc):
        recording.state = "failed"
        # Clients read this column, so it carries a mapped phrase, never ffmpeg output.
        recording.error = client_message(exc)
    else:
        recording.state = retry_state
    bump_server_seq(recording)


async def fail_abandoned_recording(ctx: JobContext, session: AsyncSession, job: Job) -> None:  # noqa: ARG001 -- matches the abandon hook's signature
    """Fail the recording of a job whose attempts all ended without recording an outcome.

    Without this, a recording a crashed attempt left in processing would stay there.
    """
    recording = await session.get(Recording, job.recording_id)
    if recording is None or recording.deleted_at is not None:
        return
    await lock_user(session, recording.user_id)
    recording.state = "failed"
    recording.error = PROCESSING_FAILED
    bump_server_seq(recording)
