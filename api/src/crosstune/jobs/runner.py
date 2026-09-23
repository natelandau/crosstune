"""Claims transcode jobs one at a time and sweeps deleted recordings and abandoned uploads."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import tempfile
import uuid
from datetime import timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Any

from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import ARRAY, Uuid, any_, delete, exists, literal, or_, select

from crosstune.db.locks import lock_user
from crosstune.jobs.media import MediaError
from crosstune.jobs.transcode import transcode
from crosstune.models import Job, Recording, UploadSlot, User
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq
from crosstune.storage.store import recording_prefix, upload_key

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

_STORAGE_ERRORS = (BotoCoreError, ClientError)


def _any_uuid(ids: Iterable[uuid.UUID]) -> ColumnElement[Any]:
    """Match against a whole id set bound as one array, since asyncpg caps bind parameters."""
    return any_(literal(list(ids), ARRAY(Uuid())))


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
        orphan_sweep_seconds: float = 3600.0,
        work_root: Path | None = None,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._store = store
        self._poll_seconds = poll_seconds
        self._orphan_sweep_seconds = orphan_sweep_seconds
        self._next_orphan_sweep = utc_now()
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
        """Run one transcode, purge a batch of deleted recordings, and sweep orphans when due.

        Returns:
            int: How many units of work were done, so the loop knows whether to sleep.
        """
        done = 0
        job = await self._claim()
        if job is not None:
            await self._transcode(job)
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
            .where(
                UploadSlot.expires_at < cutoff,
                Recording.deleted_at.is_(None),
                Recording.state == "pending_upload",
            )
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
