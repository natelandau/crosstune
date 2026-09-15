"""Claims transcode jobs one at a time and sweeps the files of deleted recordings."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import tempfile
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import or_, select

from crosstune.jobs.media import MediaError
from crosstune.jobs.transcode import transcode
from crosstune.models import Job, Recording
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq
from crosstune.storage.store import playback_key, upload_key

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
LOCK_SECONDS = 600
PURGE_BATCH = 20
STOP_TIMEOUT_SECONDS = 10.0

_STORAGE_ERRORS = (BotoCoreError, ClientError)


def _client_message(exc: Exception) -> str:
    """A short, safe description of a failure for the recording row.

    Args:
        exc: Whatever the transcode raised.

    Returns:
        str: Text a client can show. Raw exception text stays in the log and the job.
    """
    if isinstance(exc, MediaError):
        return "The audio could not be read"
    if isinstance(exc, _STORAGE_ERRORS):
        return "Storage was unavailable"
    return "Processing failed"


class JobRunner:
    """A background loop over the jobs table. One instance per process."""

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        store: ObjectStore,
        *,
        poll_seconds: float,
        work_root: Path | None = None,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._store = store
        self._poll_seconds = poll_seconds
        self._work_root = work_root
        self._stopping = asyncio.Event()
        self.task: asyncio.Task[None] | None = None

    def start(self) -> asyncio.Task[None]:
        """Run the loop as a task on the current event loop."""
        self.task = asyncio.create_task(self.run_forever(), name="job-runner")
        return self.task

    async def stop(self) -> None:
        """Ask the loop to finish its current job and exit, waiting only so long.

        A transcode cancelled at the deadline leaves its recording in processing with
        the job still locked; the lock expiry is what puts it back in the queue.
        """
        self._stopping.set()
        if self.task is None:
            return
        try:
            await asyncio.wait_for(self.task, timeout=STOP_TIMEOUT_SECONDS)
        except TimeoutError:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task

    async def run_forever(self) -> None:
        """Poll until stopped. A crash in one pass is logged and the loop continues."""
        while not self._stopping.is_set():
            try:
                worked = await self.run_once()
            except Exception:
                log.exception("job runner pass failed")
                worked = 0
            if worked == 0:
                try:
                    async with asyncio.timeout(self._poll_seconds):
                        await self._stopping.wait()
                except TimeoutError:
                    pass

    async def run_once(self) -> int:
        """Claim and run at most one transcode, then purge up to a batch of deleted recordings.

        Returns:
            int: How many units of work were done, so the loop knows whether to sleep.
        """
        done = 0
        job = await self._claim()
        if job is not None:
            await self._transcode(job)
            done += 1
        done += await self._purge()
        return done

    async def _claim(self) -> Job | None:
        now = utc_now()
        async with self._sessionmaker() as session, session.begin():
            stmt = (
                select(Job)
                .where(or_(Job.locked_until.is_(None), Job.locked_until < now))
                .order_by(Job.created_at)
                .limit(1)
                .with_for_update(skip_locked=True)
            )
            job = await session.scalar(stmt)
            if job is None:
                return None
            job.locked_until = now + timedelta(seconds=LOCK_SECONDS)
            job.attempts += 1
            # expunge() drops the row from the unit of work; flush first or these
            # changes never reach the database.
            await session.flush()
            session.expunge(job)
            return job

    async def _transcode(self, job: Job) -> None:
        """Run one job to completion, committing the setup and the outcome separately.

        transcode() issues no database statement until its own final flush, so
        the download, ffprobe, and ffmpeg work below runs with no transaction
        open and no lock held on the recording row: an API request against
        that row is never blocked for the length of a transcode.
        """
        async with self._sessionmaker() as session:
            prepared = await self._prepare(session, job)
            if prepared is None:
                return
            recording, stored_job = prepared
            source_key = upload_key(recording.user_id, recording.id)
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    await transcode(session, self._store, recording, Path(folder))
                except Exception as exc:  # noqa: BLE001 -- any transcode failure is a job failure, not a crash
                    # Roll back whatever transcode() flushed before failing, then
                    # reload so the failure state is written on top of clean data.
                    await session.rollback()
                    await session.refresh(recording)
                    await self._fail(session, stored_job, recording, exc)
                    await session.commit()
                    return
            await session.delete(stored_job)
            await session.commit()
        try:
            # The upload is redundant only once the committed row points at the
            # playback file and, when needed, the original; a failure here must not
            # turn a finished recording into a failed one. The purge sweep and the
            # next retry's overwrite bound the leak.
            await self._store.delete(source_key)
        except Exception:  # noqa: BLE001 -- a leftover upload object is bounded, not a job failure
            log.warning(
                "could not delete the finished upload", extra={"recording": str(job.recording_id)}
            )

    async def _prepare(self, session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
        """Load the row pair, mark the recording processing, and commit that alone.

        Returns:
            tuple[Recording, Job] | None: The loaded pair, or None when there is
            nothing left to transcode: the row is gone, already soft-deleted, or
            another claimer has since re-locked the job past our own claim.
        """
        async with session.begin():
            recording = await session.get(Recording, job.recording_id)
            stored_job = await session.get(Job, job.id)
            if recording is None or stored_job is None:
                return None
            if stored_job.locked_until != job.locked_until:
                # A transcode that outran LOCK_SECONDS can be re-claimed by another
                # pass; once that happens, this stale claim must do nothing.
                return None
            if recording.deleted_at is not None:
                # The purge sweep owns a deleted recording's files; nothing to transcode.
                await session.delete(stored_job)
                return None
            recording.state = "processing"
            bump_server_seq(recording)
        return recording, stored_job

    async def _fail(
        self, session: AsyncSession, job: Job, recording: Recording, exc: Exception
    ) -> None:
        raw = str(exc)
        log.warning(
            "transcode failed",
            extra={"recording": str(recording.id), "attempt": job.attempts, "error": raw},
        )
        if job.attempts >= MAX_ATTEMPTS:
            recording.state = "failed"
            # Clients read this column, so it carries a mapped phrase, never ffmpeg output.
            recording.error = _client_message(exc)
            bump_server_seq(recording)
            await session.delete(job)
            return
        recording.state = "uploaded"
        bump_server_seq(recording)
        job.last_error = raw[:500]
        # Back off a little between attempts instead of hammering a bad file.
        job.locked_until = utc_now() + timedelta(seconds=30 * job.attempts)

    async def _purge(self) -> int:
        async with self._sessionmaker() as session, session.begin():
            stmt = (
                select(Recording)
                .where(
                    Recording.deleted_at.is_not(None),
                    or_(
                        Recording.playback_key.is_not(None),
                        Recording.original_key.is_not(None),
                        Recording.state != "pending_upload",
                    ),
                )
                .limit(PURGE_BATCH)
                .with_for_update(skip_locked=True)
            )
            rows = list(await session.scalars(stmt))
            if not rows:
                return 0
            # Delete every object before touching any row, so a commit that fails
            # partway is retried by the next sweep against already-gone objects.
            keys = [
                key
                for recording in rows
                for key in (
                    upload_key(recording.user_id, recording.id),
                    # A transcode that finished after the row was read still wrote
                    # this key, so it goes whether or not the column names it.
                    playback_key(recording.user_id, recording.id),
                    recording.playback_key,
                    recording.original_key,
                )
                if key
            ]
            await self._store.delete(*keys)
            for recording in rows:
                recording.playback_key = None
                recording.original_key = None
                recording.playback_bytes = None
                recording.original_bytes = None
                recording.error = None
                # A row that a client un-deletes must upload again; it has no file any more.
                recording.state = "pending_upload"
                bump_server_seq(recording)
            return len(rows)
