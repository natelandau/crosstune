"""Claims queued jobs one at a time and sweeps deleted files and abandoned uploads."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import tempfile
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, TypeGuard

import httpx2
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import and_, case, func, or_, select, update

from crosstune.db.locks import lock_user
from crosstune.files.quota import used_bytes
from crosstune.http import BlockedAddressError
from crosstune.jobs.importer import (
    IMPORT_MIME,
    OVER_QUOTA,
    UNREACHABLE,
    ImportRefused,
    fetch_import,
)
from crosstune.jobs.media import SUBPROCESS_TIMEOUT_SECONDS, MediaError
from crosstune.jobs.peaks_job import build_recording_peaks
from crosstune.jobs.reencode import reencode
from crosstune.jobs.sweep import (
    ABANDONED_SLOT_GRACE,
    live_pending_scan_slot,
    live_pending_slot,
    purge_deleted,
    purge_deleted_scans,
    release_abandoned_slots,
)
from crosstune.jobs.sweep import sweep_orphans as sweep_orphan_prefixes
from crosstune.jobs.transcode import transcode
from crosstune.jobs.trim import trim
from crosstune.models import Job, Recording, Scan, UploadSlot
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq, enqueue_transcode, ensure_trim_job
from crosstune.recordings.trim import needs_trim
from crosstune.storage.store import PLAYBACK_MIME, delete_best_effort, original_key, upload_key
from crosstune.vocabulary import JobKind, RecordingPrecision

if TYPE_CHECKING:
    import uuid
    from collections.abc import Callable, Sequence

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.jobs.importer import FetchedImport
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
# A playback or peaks revision no row names is garbage once it is older than any
# attempt that could still commit it, with room for the bucket's clock to differ.
STRAY_REVISION_AGE = timedelta(seconds=LOCK_SECONDS + 300)
# How long a cancelled job may spend handing its claim back before shutdown goes on.
RELEASE_TIMEOUT_SECONDS = 3.0
# Each failed attempt holds its job back this much longer than the last.
RETRY_BACKOFF_SECONDS = 30
# How much of a raw failure the job row keeps for diagnosis.
LAST_ERROR_CHARS = 500
STOP_TIMEOUT_SECONDS = 10.0
# How long to wait after a pass or a due-time read fails, unless a wake comes first.
ERROR_RETRY_SECONDS = 60.0

_STORAGE_ERRORS = (BotoCoreError, ClientError)


def _dispatchable() -> ColumnElement[bool]:
    """Match the jobs whose kind `_run_job` knows, claimable now or later."""
    return Job.kind.in_([kind.value for kind in JobKind])


def _claimable(now: datetime) -> ColumnElement[bool]:
    return and_(_dispatchable(), or_(Job.locked_until.is_(None), Job.locked_until < now))


def _changed(key: str | None, other: str | None) -> str | None:
    """`key` when it names a file `other` does not, else None."""
    return key if key not in (None, other) else None


def _unnamed(recording: Recording | None, *keys: str | None) -> list[str | None]:
    """Drop any key the reloaded row still names, so a failure never deletes a live file.

    A commit that raises can still have landed; only the reloaded row knows. A row that is
    gone names nothing, and the purge sweep owns its prefix anyway.
    """
    if recording is None:
        return list(keys)
    named = {recording.playback_key, recording.peaks_key, recording.original_key}
    return [key for key in keys if key not in named]


def _still_claimed(stored_job: Job | None, claimed: Job) -> TypeGuard[Job]:
    """Whether a failing attempt may still write its job row.

    An attempt that outran LOCK_SECONDS can be claimed again by another pass, which owns
    the job row, and its recording's state, from then on. That pass may already have
    finished and deleted the row, as may this attempt's own commit that raised after landing.
    """
    return stored_job is not None and stored_job.locked_until == claimed.locked_until


async def _load_claimed(
    session: AsyncSession, job: Job, *, done: Callable[[Recording], bool]
) -> tuple[Recording, Job] | None:
    """Load a claimed job's row pair, or None when this claim has nothing left to do.

    Called inside the caller's transaction. A job whose recording `done` says needs no
    work, now or on a retry, is deleted. A claim that another pass has since re-locked,
    after this attempt outran LOCK_SECONDS, leaves the job alone.
    """
    recording = await session.get(Recording, job.recording_id)
    stored_job = await session.get(Job, job.id)
    if recording is None or not _still_claimed(stored_job, job):
        return None
    if done(recording):
        await session.delete(stored_job)
        return None
    return recording, stored_job


async def _load_locked(session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
    """Take the job's user lock and re-read its row pair fresh, as `_load_claimed` does.

    Re-read rather than taken from the identity map, since the rows may have changed
    while the job worked with no transaction open.
    """
    await lock_user(session, job.user_id)
    current = await _reload(session, Recording, job.recording_id)
    stored_job = await _reload(session, Job, job.id)
    if current is None or not _still_claimed(stored_job, job):
        return None
    if current.deleted_at is not None:
        await session.delete(stored_job)
        return None
    return current, stored_job


@dataclass
class _ImportWrite:
    """How far an import got toward its upload object, for cleanup after a failure."""

    key: str
    written: bool = False
    committing: bool = False
    committed: bool = False


def _back_off(job: Job, raw: str) -> None:
    """Keep the failure on the job and delay its retry, instead of hammering a bad file."""
    job.last_error = raw[:LAST_ERROR_CHARS]
    job.locked_until = utc_now() + timedelta(seconds=RETRY_BACKOFF_SECONDS * job.attempts)


async def _reload[T](session: AsyncSession, model: type[T], key: uuid.UUID) -> T | None:
    """Re-read a row after a rollback, or None when it no longer exists.

    `session.refresh` raises on a row deleted since it was loaded, which a reclaimed job or
    a purged recording can be by the time a failing attempt looks again.
    """
    return await session.get(model, key, populate_existing=True)


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
    if isinstance(exc, (httpx2.HTTPError, BlockedAddressError)):
        return UNREACHABLE
    return "Processing failed"


class JobRunner:
    """A background loop over the jobs table. One instance per process."""

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        store: ObjectStore,
        *,
        orphan_sweep_seconds: float = 3600.0,
        work_root: Path | None = None,
        http_client: httpx2.AsyncClient | None = None,
        settings: Settings,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._store = store
        self._http_client = http_client
        self._settings = settings
        self._orphan_sweep_seconds = orphan_sweep_seconds
        self._next_orphan_sweep = utc_now()
        self._work_root = work_root
        self._stopping = asyncio.Event()
        self._wake = asyncio.Event()
        self.task: asyncio.Task[None] | None = None

    def start(self) -> asyncio.Task[None]:
        """Run the loop as a task on the current event loop."""
        self.task = asyncio.create_task(self.run_forever(), name="job-runner")
        return self.task

    async def stop(self) -> None:
        """Ask the loop to finish its current job and exit, waiting only so long.

        A job cancelled at the deadline hands its claim straight back, uncounted, so
        the next process retries it without waiting out the lock. A recording it
        moved to processing stays there until that retry.
        """
        self._stopping.set()
        self._wake.set()
        if self.task is None:
            return
        try:
            await asyncio.wait_for(self.task, timeout=STOP_TIMEOUT_SECONDS)
        except TimeoutError:
            self.task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self.task

    def wake(self) -> None:
        """Start a pass now, for work a request has just committed."""
        self._wake.set()

    async def run_forever(self) -> None:
        """Run passes until one finds nothing, then sleep until woken or the next due time.

        No timer fires while idle, so the database and the host can both suspend. A
        crash in one pass is logged and the loop continues.
        """
        while not self._stopping.is_set():
            # Cleared before the passes, so a wake that lands during one is kept.
            self._wake.clear()
            timeout = await self._drain()
            if self._stopping.is_set():
                return
            if timeout is None:
                try:
                    timeout = max(0.0, (await self.next_due() - utc_now()).total_seconds())
                except Exception:
                    log.exception("job runner could not read its next due time")
                    timeout = ERROR_RETRY_SECONDS
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(timeout):
                    await self._wake.wait()

    async def _drain(self) -> float | None:
        """Run passes until one does no work.

        Returns:
            float | None: ERROR_RETRY_SECONDS when a pass raised, so a failing database
            is not retried in a tight loop, or None when the work simply ran out.
        """
        while not self._stopping.is_set():
            try:
                worked = await self.run_once()
            except Exception:
                log.exception("job runner pass failed")
                return ERROR_RETRY_SECONDS
            if worked == 0:
                return None
        return None

    async def next_due(self) -> datetime:
        """The earliest time a pass could find work that no wake announces.

        That is a backed-off or expired job lock, an upload slot of a pending or
        deleted row passing its abandonment grace, or the next orphan sweep, which
        bounds the sleep to `orphan_sweep_seconds`. Other purges have no due time;
        the delete that makes one wakes the runner.

        Returns:
            datetime: When the idle loop should run its next pass.
        """
        async with self._sessionmaker() as session:
            job_due = await session.scalar(
                select(func.min(Job.locked_until)).where(_dispatchable())
            )
            slot_expiries = [
                await session.scalar(
                    select(func.min(UploadSlot.expires_at))
                    .join(Recording, UploadSlot.recording_id == Recording.id)
                    .where(or_(live_pending_slot(), Recording.deleted_at.is_not(None)))
                ),
                await session.scalar(
                    select(func.min(UploadSlot.expires_at))
                    .join(Scan, UploadSlot.scan_id == Scan.id)
                    .where(or_(live_pending_scan_slot(), Scan.deleted_at.is_not(None)))
                ),
            ]
        candidates = [self._next_orphan_sweep]
        if job_due is not None:
            candidates.append(job_due)
        candidates += [
            expiry + ABANDONED_SLOT_GRACE for expiry in slot_expiries if expiry is not None
        ]
        return min(candidates)

    async def run_once(self) -> int:
        """Run one job, purge a batch of deleted recordings and scans, and sweep orphans when due.

        Returns:
            int: How many units of work were done, so the loop knows whether to sleep.
        """
        done = 0
        job = await self._claim()
        if job is not None:
            await self._run_job(job)
            done += 1
        done += await self._purge()
        done += await release_abandoned_slots(self._sessionmaker, self._store)
        # Last, so a bucket listing that fails cannot starve the transcodes and purges.
        if utc_now() >= self._next_orphan_sweep:
            self._next_orphan_sweep = utc_now() + timedelta(seconds=self._orphan_sweep_seconds)
            done += await self.sweep_orphans()
        return done

    async def sweep_orphans(self) -> int:
        """Delete the bucket prefixes of users, recordings, and scans that have no row."""
        return await sweep_orphan_prefixes(
            self._sessionmaker, self._store, stray_after=STRAY_REVISION_AGE
        )

    async def _purge(self) -> int:
        purged = await purge_deleted(self._sessionmaker, self._store)
        return purged + await purge_deleted_scans(self._sessionmaker, self._store)

    async def _claim(self) -> Job | None:
        now = utc_now()
        async with self._sessionmaker() as session, session.begin():
            stmt = (
                select(Job)
                .where(_claimable(now))
                # A backfill re-encode waits behind every other kind, so it never delays
                # a new take or a trim.
                .order_by(case((Job.kind == JobKind.REENCODE.value, 1), else_=0), Job.created_at)
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

    async def _run_job(self, job: Job) -> None:
        """Dispatch a claimed job to the method that knows its kind.

        `_claim` only hands this a kind `JobKind` names. Any other kind can't come
        from a current claim, but is dropped rather than left locked forever if one
        ever does.
        """
        try:
            await self._dispatch(job)
        except asyncio.CancelledError:
            await self._release_claim(job)
            raise

    async def _dispatch(self, job: Job) -> None:
        if job.kind == JobKind.TRANSCODE.value:
            await self._transcode(job)
        elif job.kind == JobKind.PEAKS.value:
            await self._peaks(job)
        elif job.kind == JobKind.TRIM.value:
            await self._trim(job)
        elif job.kind == JobKind.IMPORT.value:
            await self._import(job)
        elif job.kind == JobKind.REENCODE.value:
            await self._reencode(job)
        else:
            log.warning(
                "dropping a job of unknown kind", extra={"kind": job.kind, "job": str(job.id)}
            )
            async with self._sessionmaker() as session, session.begin():
                stored_job = await session.get(Job, job.id)
                if stored_job is not None and stored_job.locked_until == job.locked_until:
                    await session.delete(stored_job)

    async def _release_claim(self, job: Job) -> None:
        """Put a cancelled job back in the queue now, without counting the attempt.

        A shutdown is no fault of the file, so it must not use up one of its attempts.
        Matching on this claim's lock leaves a job alone that has since finished,
        failed, or been claimed by another pass.
        """
        try:
            async with (
                asyncio.timeout(RELEASE_TIMEOUT_SECONDS),
                self._sessionmaker() as session,
                session.begin(),
            ):
                await session.execute(
                    update(Job)
                    .where(Job.id == job.id, Job.locked_until == job.locked_until)
                    .values(locked_until=None, attempts=Job.attempts - 1)
                )
        except Exception:  # noqa: BLE001 -- the lock expiry still frees the job
            log.warning("could not release a cancelled job", extra={"job": str(job.id)})

    async def _delete_stale(self, *keys: str | None) -> None:
        """Best-effort delete of objects a job's own write superseded or orphaned.

        Never called with an original key: the original is never deleted, since a
        retry or a later job only ever overwrites it in place.
        """
        await delete_best_effort(
            self._store, keys, log=log, message="could not delete a superseded object"
        )

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
            previous_playback_key = recording.playback_key
            previous_peaks_key = recording.peaks_key
            committing = False
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    async with asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS):
                        await transcode(session, self._store, recording, Path(folder))
                    await session.delete(stored_job)
                    await ensure_trim_job(session, recording)
                    committing = True
                    await session.commit()
                except asyncio.CancelledError:
                    # A commit the cancel interrupted may have landed and named these,
                    # so only files uploaded before it are deleted; the sweep gets the rest.
                    if not committing:
                        await self._delete_stale(
                            _changed(recording.playback_key, previous_playback_key),
                            _changed(recording.peaks_key, previous_peaks_key),
                        )
                    raise
                except Exception as exc:  # noqa: BLE001 -- any transcode failure is a job failure, not a crash
                    # Whatever this attempt itself uploaded before failing is an
                    # orphan once the rollback below discards the row's write.
                    orphaned_playback_key = _changed(recording.playback_key, previous_playback_key)
                    orphaned_peaks_key = _changed(recording.peaks_key, previous_peaks_key)
                    # Roll back whatever transcode() flushed before failing, then
                    # reload so the failure state is written on top of clean data.
                    await session.rollback()
                    reloaded = await _reload(session, Recording, job.recording_id)
                    stored = await _reload(session, Job, job.id)
                    if reloaded is not None and _still_claimed(stored, job):
                        await self._fail(session, stored, reloaded, exc)
                    await session.commit()
                    await self._delete_stale(
                        *_unnamed(reloaded, orphaned_playback_key, orphaned_peaks_key)
                    )
                    return
            stale_playback_key = _changed(previous_playback_key, recording.playback_key)
            stale_peaks_key = _changed(previous_peaks_key, recording.peaks_key)
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
        await self._delete_stale(stale_playback_key, stale_peaks_key)

    async def _prepare(self, session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
        """Load the row pair, mark the recording processing, and commit that alone.

        Returns:
            tuple[Recording, Job] | None: The loaded pair, or None when there is
            nothing left to transcode: the row is gone, already soft-deleted, or
            another claimer has since re-locked the job past our own claim.
        """
        async with session.begin():
            # The purge sweep owns a deleted recording's files; nothing to transcode.
            prepared = await _load_claimed(
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

    async def _fail(
        self,
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
        raw = str(exc)
        log.warning(
            "job failed",
            extra={
                "recording": str(recording.id),
                "kind": job.kind,
                "attempt": job.attempts,
                "error": raw,
            },
        )
        await lock_user(session, recording.user_id)
        if job.attempts >= MAX_ATTEMPTS:
            recording.state = "failed"
            # Clients read this column, so it carries a mapped phrase, never ffmpeg output.
            recording.error = _client_message(exc)
            bump_server_seq(recording)
            await session.delete(job)
            return
        recording.state = retry_state
        bump_server_seq(recording)
        _back_off(job, raw)

    async def _peaks(self, job: Job) -> None:
        """Build one recording's waveform peaks, never moving it through processing."""
        async with self._sessionmaker() as session:
            prepared = await self._prepare_peaks(session, job)
            if prepared is None:
                return
            recording, stored_job = prepared
            previous_peaks_key = recording.peaks_key
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    async with asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS):
                        await build_recording_peaks(session, self._store, recording, Path(folder))
                except Exception as exc:  # noqa: BLE001 -- any failure here is a job failure, not a crash
                    await session.rollback()
                    reloaded = await _reload(session, Recording, job.recording_id)
                    stored = await _reload(session, Job, job.id)
                    if reloaded is not None and _still_claimed(stored, job):
                        await self._fail_peaks(session, stored, reloaded, exc)
                    await session.commit()
                    return
            # build_recording_peaks() holds the user's lock past its own return; a trim
            # pushed while this job ran is only visible to ensure_trim_job read fresh now.
            await session.refresh(recording, attribute_names=["trim_start_ms", "trim_end_ms"])
            await session.delete(stored_job)
            await ensure_trim_job(session, recording)
            await session.commit()
            stale_peaks_key = _changed(previous_peaks_key, recording.peaks_key)
        await self._delete_stale(stale_peaks_key)

    async def _prepare_peaks(self, session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
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
            return await _load_claimed(
                session,
                job,
                done=lambda recording: (
                    recording.deleted_at is not None or recording.playback_key is None
                ),
            )

    async def _fail_peaks(
        self, session: AsyncSession, job: Job, recording: Recording, exc: Exception
    ) -> None:
        """Record a peaks failure without ever touching the recording row."""
        raw = str(exc)
        log.warning(
            "peaks build failed",
            extra={"recording": str(recording.id), "attempt": job.attempts, "error": raw},
        )
        if job.attempts >= MAX_ATTEMPTS:
            await session.delete(job)
            return
        _back_off(job, raw)

    async def _import(self, job: Job) -> None:
        """Fetch an imported recording's audio into its upload object and queue a transcode.

        The download and the bucket write run with no transaction open and no lock held,
        so the user's pushes never wait on Slippery-Hill or the bucket. Only then does a
        transaction take the user's lock, check the quota, and hand the recording to a
        transcode, so two imports can't both fit in the same free space. Any failure
        between the write and that commit deletes the object.
        """
        async with self._sessionmaker() as session:
            async with session.begin():
                prepared = await _load_claimed(
                    session, job, done=lambda recording: recording.deleted_at is not None
                )
            if prepared is None:
                return
            recording, _ = prepared
            write = _ImportWrite(key=upload_key(recording.user_id, recording.id))
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    async with asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS):
                        path = Path(folder) / "import"
                        fetched = await fetch_import(
                            self._import_client(),
                            recording,
                            path,
                            max_bytes=self._settings.recording_max_file_bytes,
                            timeout=self._settings.link_resolve_timeout_seconds,
                        )
                        write.written = True
                        await self._store.upload(path, write.key, IMPORT_MIME)
                        await self._commit_import(session, job, fetched, write)
                except asyncio.CancelledError:
                    # A commit the cancel interrupted may have landed and queued a transcode
                    # of this file, so only an upload that never reached a commit is removed.
                    if write.written and not write.committing:
                        await self._delete_stale(write.key)
                    raise
                except Exception as exc:  # noqa: BLE001 -- any import failure is a job failure, not a crash
                    current: Recording | None = None
                    async with session.begin():
                        current = await _reload(session, Recording, job.recording_id)
                        stored_job = await _reload(session, Job, job.id)
                        if current is not None and _still_claimed(stored_job, job):
                            await self._fail_import(session, stored_job, current, exc)
                    if write.written:
                        await self._discard_upload(current, write.key)
                    return
            if write.written and not write.committed:
                async with session.begin():
                    current = await _reload(session, Recording, job.recording_id)
                await self._discard_upload(current, write.key)

    def _import_client(self) -> httpx2.AsyncClient:
        if self._http_client is None:
            msg = "the job runner has no HTTP client for imports"
            raise RuntimeError(msg)
        return self._http_client

    async def _commit_import(
        self, session: AsyncSession, job: Job, fetched: FetchedImport, write: _ImportWrite
    ) -> None:
        """Under the user's lock, check the quota and hand the uploaded file to a transcode.

        Dates the recording from its page's year unless it already has a recorded date,
        which the user may have set while the file downloaded. Leaves `write.committed`
        false when the job is no longer this attempt's to finish.

        Raises:
            ImportRefused: When the file would take the user past their quota.
        """
        async with session.begin():
            prepared = await _load_locked(session, job)
            if prepared is None:
                return
            recording, stored_job = prepared
            used = await used_bytes(session, recording.user_id, exclude=recording.id)
            if used + fetched.size > self._settings.storage_quota_bytes:
                raise ImportRefused(OVER_QUOTA)
            if fetched.year is not None and recording.recorded_at is None:
                recording.recorded_at = datetime(fetched.year, 1, 1, tzinfo=UTC)
                recording.recorded_precision = RecordingPrecision.YEAR.value
            recording.playback_bytes = fetched.size
            recording.state = "uploaded"
            recording.error = None
            bump_server_seq(recording)
            await session.delete(stored_job)
            await enqueue_transcode(session, recording)
            write.committing = True
        write.committed = True

    async def _discard_upload(self, recording: Recording | None, key: str) -> None:
        """Delete an import's upload object unless the row shows a landed commit using it.

        A commit that raised can still have landed, and another pass may have finished
        the job. Only that commit sets `playback_bytes`, and the transcode it queued may
        already have moved the row on to `processing` or `failed` while it still needs
        the file.
        """
        if recording is None or recording.playback_bytes is None:
            await self._delete_stale(key)

    async def _fail_import(
        self, session: AsyncSession, job: Job, recording: Recording, exc: Exception
    ) -> None:
        """Fail a refused import at once; retry anything else while it stays processing."""
        if not isinstance(exc, ImportRefused):
            await self._fail(session, job, recording, exc, retry_state="processing")
            return
        log.info("import refused", extra={"recording": str(recording.id), "error": str(exc)})
        await lock_user(session, recording.user_id)
        recording.state = "failed"
        recording.error = str(exc)
        bump_server_seq(recording)
        await session.delete(job)

    async def _trim(self, job: Job) -> None:
        """Re-cut one recording's playback file to its saved trim, never leaving ready.

        Like a transcode, the download and ffmpeg work run with no transaction open.
        The superseded files are deleted only after the commit that stops pointing at
        them, so a failure anywhere before it leaves the recording playing as before.
        """
        async with self._sessionmaker() as session:
            prepared = await self._prepare_trim(session, job)
            if prepared is None:
                return
            recording, stored_job = prepared
            previous_playback_key = recording.playback_key
            previous_peaks_key = recording.peaks_key
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    async with asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS):
                        superseded = await trim(session, self._store, recording, Path(folder))
                    await session.delete(stored_job)
                    # trim() read the trim columns fresh under the lock, so a trim saved
                    # while it ran, which found this job holding the one trim slot, is
                    # queued now.
                    await ensure_trim_job(session, recording)
                    await session.commit()
                except asyncio.CancelledError:
                    await self._release_cancelled_trim_backup(session, job)
                    raise
                except Exception as exc:  # noqa: BLE001 -- any trim failure is a job failure, not a crash
                    # trim() deletes its own uploads when it raises; these are only set
                    # once it has returned and something after it failed.
                    orphaned = [
                        key
                        for key in (recording.playback_key, recording.peaks_key)
                        if key not in (None, previous_playback_key, previous_peaks_key)
                    ]
                    await self._recover_failed_recut(
                        session, job, exc, orphaned=orphaned, release_backup=True
                    )
                    return
        await self._delete_stale(*superseded)

    async def _recover_failed_recut(
        self,
        session: AsyncSession,
        job: Job,
        exc: Exception,
        *,
        orphaned: Sequence[str | None],
        release_backup: bool,
    ) -> None:
        """Roll back a failed trim or re-encode, record the failure, and delete its orphans.

        Args:
            session: The job's session, with the failed attempt's writes still pending.
            job: The claimed job.
            exc: What the attempt raised.
            orphaned: Files the attempt uploaded that only its rolled-back write named.
            release_backup: Whether to delete an original backup the attempt copied but
                never got to name on the row.
        """
        await session.rollback()
        stored = await _reload(session, Job, job.id)
        if release_backup:
            reloaded = await self._release_trim_backup(session, job)
        else:
            reloaded = await _reload(session, Recording, job.recording_id)
        if _still_claimed(stored, job):
            if stored.attempts >= MAX_ATTEMPTS:
                log.error(
                    "%s gave up",
                    job.kind,
                    exc_info=exc,
                    extra={"recording": str(job.recording_id), "attempt": job.attempts},
                )
            await self._fail_keeping_row(session, stored, exc)
        await session.commit()
        await self._delete_stale(*_unnamed(reloaded, *orphaned))

    async def _release_cancelled_trim_backup(self, session: AsyncSession, job: Job) -> None:
        """Delete the backup a cancelled trim copied but never named, within a short budget.

        The released job may find nothing left to cut when it is retried, and then no
        attempt would ever come back for the backup.
        """
        try:
            async with asyncio.timeout(RELEASE_TIMEOUT_SECONDS):
                await session.rollback()
                await self._release_trim_backup(session, job)
                await session.commit()
        except Exception:  # noqa: BLE001 -- the recording's purge still removes it
            log.warning(
                "could not release a cancelled trim's backup",
                extra={"recording": str(job.recording_id)},
            )

    async def _release_trim_backup(self, session: AsyncSession, job: Job) -> Recording | None:
        """Delete an original a failed trim copied but never got to name on the row.

        Runs under the user's lock, where `trim` checks its backup still exists
        before committing it, so this never removes an original some row names.

        Returns:
            Recording | None: The row as reloaded under the lock, or None once it is gone,
            when the purge sweep owns its whole prefix.
        """
        # The rollback expired the row, so its ids come from the job.
        await lock_user(session, job.user_id)
        recording = await _reload(session, Recording, job.recording_id)
        if recording is None or recording.original_key is not None:
            return recording
        await delete_best_effort(
            self._store,
            [original_key(job.user_id, job.recording_id, PLAYBACK_MIME)],
            log=log,
            message="could not delete an unkept original backup",
        )
        return recording

    async def _prepare_trim(self, session: AsyncSession, job: Job) -> tuple[Recording, Job] | None:
        """Load the row pair for a trim job. Never marks the recording processing.

        Returns:
            tuple[Recording, Job] | None: The loaded pair, or None when there is
            nothing left to cut: the row is gone, soft-deleted, already matches its
            trim, or another claimer has since re-locked the job past our own claim.
        """
        async with session.begin():
            # The purge sweep owns a deleted recording's files, and a row that already
            # matches has nothing to cut; a later trim queues a new job.
            return await _load_claimed(
                session,
                job,
                done=lambda recording: (
                    recording.deleted_at is not None or not needs_trim(recording)
                ),
            )

    async def _fail_keeping_row(self, session: AsyncSession, job: Job, exc: Exception) -> None:
        """Record a trim or re-encode failure without ever touching the recording row.

        The row stays ready on its current files, which clients keep playing
        correctly through the seek offsets, so a job that keeps failing stops
        after its last attempt; its caller reports that one.
        """
        if job.attempts >= MAX_ATTEMPTS:
            await session.delete(job)
            return
        raw = str(exc)
        log.warning(
            "job failed",
            extra={
                "recording": str(job.recording_id),
                "kind": job.kind,
                "attempt": job.attempts,
                "error": raw,
            },
        )
        _back_off(job, raw)

    async def _reencode(self, job: Job) -> None:
        """Re-cut one recording's playback file from its original, never leaving ready.

        Like a trim, the download and ffmpeg work run with no transaction open, and the
        superseded file is deleted only after the commit that stops pointing at it.
        """
        async with self._sessionmaker() as session:
            prepared = await self._prepare_reencode(session, job)
            if prepared is None:
                return
            recording, stored_job = prepared
            previous_playback_key = recording.playback_key
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    async with asyncio.timeout(ATTEMPT_TIMEOUT_SECONDS):
                        replacement = await reencode(session, self._store, recording, Path(folder))
                    await session.delete(stored_job)
                    await session.commit()
                except Exception as exc:  # noqa: BLE001 -- any re-encode failure is a job failure, not a crash
                    # reencode() deletes its own upload when it raises; this is only set
                    # once it has returned and something after it failed.
                    orphaned = _changed(recording.playback_key, previous_playback_key)
                    await self._recover_failed_recut(
                        session, job, exc, orphaned=[orphaned], release_backup=False
                    )
                    return
        if replacement is not None:
            replacement.log_committed()
            await self._delete_stale(replacement.superseded_key)

    async def _prepare_reencode(
        self, session: AsyncSession, job: Job
    ) -> tuple[Recording, Job] | None:
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
            return await _load_claimed(
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
