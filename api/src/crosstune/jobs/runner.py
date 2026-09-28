"""Claims queued jobs one at a time and sweeps deleted recordings and abandoned uploads."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import tempfile
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any, TypeGuard

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import ARRAY, Uuid, and_, any_, delete, exists, func, literal, or_, select

from crosstune.db.locks import lock_user
from crosstune.jobs.media import MediaError
from crosstune.jobs.peaks_job import build_recording_peaks
from crosstune.jobs.transcode import transcode
from crosstune.jobs.trim import trim
from crosstune.models import Job, Recording, UploadSlot, User
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq, ensure_trim_job
from crosstune.recordings.trim import needs_trim
from crosstune.storage.store import (
    PLAYBACK_MIME,
    delete_best_effort,
    original_key,
    recording_prefix,
    upload_key,
)
from crosstune.vocabulary import JobKind

if TYPE_CHECKING:
    from collections.abc import Iterable

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
LOCK_SECONDS = 600
PURGE_BATCH = 20
# A PUT signed just before its slot expired can still be arriving; past this it is abandoned.
ABANDONED_SLOT_GRACE = timedelta(hours=1)
STOP_TIMEOUT_SECONDS = 10.0
# How long to wait after a pass or a due-time read fails, unless a wake comes first.
ERROR_RETRY_SECONDS = 60.0

_STORAGE_ERRORS = (BotoCoreError, ClientError)


def _any_uuid(ids: Iterable[uuid.UUID]) -> ColumnElement[Any]:
    """Match against a whole id set bound as one array, since asyncpg caps bind parameters."""
    return any_(literal(list(ids), ARRAY(Uuid())))


def _dispatchable() -> ColumnElement[bool]:
    """Match the jobs whose kind `_run_job` knows, claimable now or later."""
    return Job.kind.in_([kind.value for kind in JobKind])


def _claimable(now: datetime) -> ColumnElement[bool]:
    return and_(_dispatchable(), or_(Job.locked_until.is_(None), Job.locked_until < now))


def _live_pending_slot() -> ColumnElement[bool]:
    """Match the slots of live recordings still waiting on their upload."""
    return and_(Recording.deleted_at.is_(None), Recording.state == "pending_upload")


def _as_uuid(segment: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(segment)
    except ValueError:
        return None


def _owned_prefixes(
    keys: list[str],
) -> tuple[dict[uuid.UUID, str], dict[tuple[uuid.UUID, uuid.UUID], str]]:
    """Group keys by the user and recording ids their first two segments name.

    A segment that is not a UUID is not ours, so no prefix is built from it, and a
    key with a single segment belongs to no user.

    Returns:
        tuple: The user prefixes by user id, and the recording prefixes by
        (user id, recording id).
    """
    users: dict[uuid.UUID, str] = {}
    recordings: dict[tuple[uuid.UUID, uuid.UUID], str] = {}
    for key in keys:
        user_segment, has_user, rest = key.partition("/")
        user_id = _as_uuid(user_segment) if has_user else None
        if user_id is None:
            continue
        users.setdefault(user_id, f"{user_segment}/")
        recording_segment, has_recording, _ = rest.partition("/")
        recording_id = _as_uuid(recording_segment) if has_recording else None
        if recording_id is not None:
            recordings.setdefault((user_id, recording_id), f"{user_segment}/{recording_segment}/")
    return users, recordings


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
    ) -> None:
        self._sessionmaker = sessionmaker
        self._store = store
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

        A transcode cancelled at the deadline leaves its recording in processing with
        the job still locked; the lock expiry is what puts it back in the queue.
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

        That is a backed-off or expired job lock, an upload slot passing its
        abandonment grace, or the next orphan sweep, which bounds the sleep to
        `orphan_sweep_seconds`. Purges have no due time; the delete that makes one
        wakes the runner.

        Returns:
            datetime: When the idle loop should run its next pass.
        """
        async with self._sessionmaker() as session:
            job_due = await session.scalar(
                select(func.min(Job.locked_until)).where(_dispatchable())
            )
            slot_expiry = await session.scalar(
                select(func.min(UploadSlot.expires_at))
                .join(Recording, UploadSlot.recording_id == Recording.id)
                .where(_live_pending_slot())
            )
        candidates = [self._next_orphan_sweep]
        if job_due is not None:
            candidates.append(job_due)
        if slot_expiry is not None:
            candidates.append(slot_expiry + ABANDONED_SLOT_GRACE)
        return min(candidates)

    async def run_once(self) -> int:
        """Run one job, purge a batch of deleted recordings, and sweep orphans when due.

        Returns:
            int: How many units of work were done, so the loop knows whether to sleep.
        """
        done = 0
        job = await self._claim()
        if job is not None:
            await self._run_job(job)
            done += 1
        done += await self._purge()
        done += await self._release_abandoned_slots()
        # Last, so a bucket listing that fails cannot starve the transcodes and purges.
        if utc_now() >= self._next_orphan_sweep:
            self._next_orphan_sweep = utc_now() + timedelta(seconds=self._orphan_sweep_seconds)
            done += await self.sweep_orphans()
        return done

    async def sweep_orphans(self) -> int:
        """Delete every user prefix with no user row, then every recording prefix with no row.

        Account deletion removes the row first and wipes the bucket best-effort
        afterwards; this sweep is what makes the wipe certain. A user row exists
        before any key is issued under its id, a recording row before any upload
        URL under its id, and ids are never reused, so a UUID prefix with no row
        is always garbage. Other prefixes are not ours to touch.

        One listing and two queries per sweep, however many users the bucket holds.

        Returns:
            int: How many prefixes were removed.
        """
        users, recordings = _owned_prefixes(await self._store.list_keys())
        if not users:
            return 0
        async with self._sessionmaker() as session:
            live = set(await session.scalars(select(User.id).where(User.id == _any_uuid(users))))
            candidates = {pair: prefix for pair, prefix in recordings.items() if pair[0] in live}
            known: set[tuple[uuid.UUID, uuid.UUID]] = set()
            if candidates:
                rows = await session.execute(
                    select(Recording.user_id, Recording.id).where(
                        Recording.id == _any_uuid(recording_id for _, recording_id in candidates)
                    )
                )
                known = {(user_id, recording_id) for user_id, recording_id in rows.tuples()}
        orphans = [prefix for user_id, prefix in users.items() if user_id not in live]
        orphans += [prefix for pair, prefix in candidates.items() if pair not in known]
        await asyncio.gather(*(self._store.delete_prefix(prefix) for prefix in orphans))
        return len(orphans)

    async def _claim(self) -> Job | None:
        now = utc_now()
        async with self._sessionmaker() as session, session.begin():
            stmt = (
                select(Job)
                .where(_claimable(now))
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

    async def _run_job(self, job: Job) -> None:
        """Dispatch a claimed job to the method that knows its kind.

        `_claim` only hands this a kind `JobKind` names. Any other kind can't come
        from a current claim, but is dropped rather than left locked forever if one
        ever does.
        """
        if job.kind == JobKind.TRANSCODE.value:
            await self._transcode(job)
        elif job.kind == JobKind.PEAKS.value:
            await self._peaks(job)
        elif job.kind == JobKind.TRIM.value:
            await self._trim(job)
        else:
            log.warning(
                "dropping a job of unknown kind", extra={"kind": job.kind, "job": str(job.id)}
            )
            async with self._sessionmaker() as session, session.begin():
                stored_job = await session.get(Job, job.id)
                if stored_job is not None and stored_job.locked_until == job.locked_until:
                    await session.delete(stored_job)

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
            with tempfile.TemporaryDirectory(dir=self._work_root) as folder:
                try:
                    await transcode(session, self._store, recording, Path(folder))
                    await session.delete(stored_job)
                    await ensure_trim_job(session, recording)
                    await session.commit()
                except Exception as exc:  # noqa: BLE001 -- any transcode failure is a job failure, not a crash
                    # Whatever this attempt itself uploaded before failing is an
                    # orphan once the rollback below discards the row's write.
                    orphaned_playback_key = (
                        recording.playback_key
                        if recording.playback_key not in (None, previous_playback_key)
                        else None
                    )
                    orphaned_peaks_key = (
                        recording.peaks_key
                        if recording.peaks_key not in (None, previous_peaks_key)
                        else None
                    )
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
            stale_playback_key = (
                previous_playback_key
                if previous_playback_key not in (None, recording.playback_key)
                else None
            )
            stale_peaks_key = (
                previous_peaks_key
                if previous_peaks_key not in (None, recording.peaks_key)
                else None
            )
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
            # Every server_seq the runner draws is taken under the user's lock, like a
            # push: a seq drawn outside it can commit after a higher one, and a pull
            # cursor that has passed it never returns.
            await lock_user(session, recording.user_id)
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
        await lock_user(session, recording.user_id)
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
            stale_peaks_key = (
                previous_peaks_key
                if previous_peaks_key not in (None, recording.peaks_key)
                else None
            )
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
            recording = await session.get(Recording, job.recording_id)
            stored_job = await session.get(Job, job.id)
            if recording is None or stored_job is None:
                return None
            if stored_job.locked_until != job.locked_until:
                return None
            if recording.deleted_at is not None or recording.playback_key is None:
                # Nothing to build peaks from, now or on a retry; only a transcode
                # or trim job ever sets a playback file, so waiting won't help this job.
                await session.delete(stored_job)
                return None
        return recording, stored_job

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
        job.last_error = raw[:500]
        job.locked_until = utc_now() + timedelta(seconds=30 * job.attempts)

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
                    superseded = await trim(session, self._store, recording, Path(folder))
                    await session.delete(stored_job)
                    # trim() read the trim columns fresh under the lock, so a trim saved
                    # while it ran, which found this job holding the one trim slot, is
                    # queued now.
                    await ensure_trim_job(session, recording)
                    await session.commit()
                except Exception as exc:
                    # trim() deletes its own uploads when it raises; these are only set
                    # once it has returned and something after it failed.
                    orphaned = [
                        key
                        for key in (recording.playback_key, recording.peaks_key)
                        if key not in (None, previous_playback_key, previous_peaks_key)
                    ]
                    await session.rollback()
                    stored = await _reload(session, Job, job.id)
                    reloaded = await self._release_trim_backup(session, job)
                    if _still_claimed(stored, job):
                        if stored.attempts >= MAX_ATTEMPTS:
                            log.exception(
                                "trim gave up",
                                extra={"recording": str(job.recording_id), "attempt": job.attempts},
                            )
                        await self._fail_trim(session, stored, exc)
                    await session.commit()
                    await self._delete_stale(*_unnamed(reloaded, *orphaned))
                    return
        await self._delete_stale(*superseded)

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
            recording = await session.get(Recording, job.recording_id)
            stored_job = await session.get(Job, job.id)
            if recording is None or stored_job is None:
                return None
            if stored_job.locked_until != job.locked_until:
                return None
            if recording.deleted_at is not None or not needs_trim(recording):
                # The purge sweep owns a deleted recording's files, and a row that
                # already matches has nothing to cut; a later trim queues a new job.
                await session.delete(stored_job)
                return None
        return recording, stored_job

    async def _fail_trim(self, session: AsyncSession, job: Job, exc: Exception) -> None:
        """Record a trim failure without ever touching the recording row.

        The row stays ready on its current files, which clients keep playing
        correctly through the seek offsets, so a trim that keeps failing stops
        after its last attempt; `_trim` reports that one.
        """
        if job.attempts >= MAX_ATTEMPTS:
            await session.delete(job)
            return
        raw = str(exc)
        log.warning(
            "trim failed",
            extra={"recording": str(job.recording_id), "attempt": job.attempts, "error": raw},
        )
        job.last_error = raw[:500]
        job.locked_until = utc_now() + timedelta(seconds=30 * job.attempts)

    async def _release_abandoned_slots(self) -> int:
        """Delete what an upload slot that was never confirmed may have left in the bucket.

        An expired slot stops counting against the quota, so an object PUT under it and
        never confirmed would otherwise stay in the bucket uncounted.

        Returns:
            int: How many slots were released.
        """
        cutoff = utc_now() - ABANDONED_SLOT_GRACE
        stmt = (
            select(Recording)
            .join(UploadSlot, UploadSlot.recording_id == Recording.id)
            .where(UploadSlot.expires_at < cutoff, _live_pending_slot())
            .limit(PURGE_BATCH)
        )
        async with self._sessionmaker() as session:
            async with session.begin():
                rows = list(await session.scalars(stmt))
            if not rows:
                return 0
            await self._store.delete(*(upload_key(r.user_id, r.id) for r in rows))
            async with session.begin():
                for user_id in sorted({recording.user_id for recording in rows}):
                    await lock_user(session, user_id)
                # Re-checked under the locks, so a slot reissued meanwhile stays open and its
                # recording, which a confirmation may already have moved on, is left alone.
                released = set(
                    await session.scalars(
                        delete(UploadSlot)
                        .where(
                            UploadSlot.recording_id.in_([r.id for r in rows]),
                            UploadSlot.expires_at < cutoff,
                        )
                        .returning(UploadSlot.recording_id)
                    )
                )
                for recording in rows:
                    if recording.id not in released:
                        continue
                    # A failed upload's object was counted through playback_bytes, and is gone.
                    if recording.playback_bytes is not None:
                        recording.playback_bytes = None
                        bump_server_seq(recording)
            return len(rows)

    async def _purge(self) -> int:
        """Remove the files of soft-deleted recordings and leave their rows ready to upload again.

        Returns:
            int: How many recordings were swept.
        """
        has_slot = exists().where(UploadSlot.recording_id == Recording.id)
        stmt = (
            select(Recording)
            .where(
                Recording.deleted_at.is_not(None),
                or_(
                    Recording.playback_key.is_not(None),
                    Recording.original_key.is_not(None),
                    Recording.state != "pending_upload",
                    # A slot means a PUT may have landed that no /uploaded call will ever claim.
                    has_slot,
                ),
            )
            .limit(PURGE_BATCH)
        )
        async with self._sessionmaker() as session:
            async with session.begin():
                rows = list(await session.scalars(stmt))
            if not rows:
                return 0
            # Delete every object before touching any row, so a commit that fails
            # partway is retried by the next sweep against already-gone objects.
            # The prefix also catches objects the row never named: a playback file
            # written after the row was read, or an original copied by a transcode
            # that failed before it could commit the key.
            await asyncio.gather(
                *(
                    self._store.delete_prefix(recording_prefix(recording.user_id, recording.id))
                    for recording in rows
                )
            )
            async with session.begin():
                # The row updates draw a server_seq each, so they run under every
                # affected user's lock, taken in one fixed order so two sweeps cannot
                # wait on each other. Taken only now, so no push waits on the bucket.
                for user_id in sorted({recording.user_id for recording in rows}):
                    await lock_user(session, user_id)
                await session.execute(
                    delete(UploadSlot).where(UploadSlot.recording_id.in_([r.id for r in rows]))
                )
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
