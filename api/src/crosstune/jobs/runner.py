"""Claims queued jobs one at a time and sweeps deleted files and abandoned uploads."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, case, func, or_, select, update

from crosstune.db.base import utc_now
from crosstune.jobs import analytics
from crosstune.jobs.attempt import (
    LOCK_SECONDS,
    MAX_ATTEMPTS,
    RELEASE_TIMEOUT_SECONDS,
    JobContext,
    still_claimed,
)
from crosstune.jobs.handlers import HANDLERS
from crosstune.jobs.sweep import (
    ABANDONED_SLOT_GRACE,
    live_pending_scan_slot,
    live_pending_slot,
    purge_deleted,
    purge_deleted_scans,
    release_abandoned_slots,
)
from crosstune.jobs.sweep import sweep_orphans as sweep_orphan_prefixes
from crosstune.models import Job, Recording, Scan, UploadSlot
from crosstune.vocabulary import JobKind

if TYPE_CHECKING:
    from pathlib import Path

    import httpx2
    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.analytics.posthog import AnalyticsPersons
    from crosstune.config import Settings
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

# A playback or peaks revision no row names is garbage once it is older than any
# attempt that could still commit it, with room for the bucket's clock to differ.
STRAY_REVISION_AGE = timedelta(seconds=LOCK_SECONDS + 300)
STOP_TIMEOUT_SECONDS = 10.0
# How long to wait after a pass or a due-time read fails, unless a wake comes first.
ERROR_RETRY_SECONDS = 60.0

_BACKGROUND_KINDS = [kind.value for kind, handler in HANDLERS.items() if handler.background]


def _dispatchable() -> ColumnElement[bool]:
    """Match the jobs whose kind has a handler, claimable now or later."""
    return Job.kind.in_([kind.value for kind in HANDLERS])


def _claimable(now: datetime) -> ColumnElement[bool]:
    return and_(_dispatchable(), or_(Job.locked_until.is_(None), Job.locked_until < now))


class JobRunner:
    """A background loop over the jobs table. One instance per process."""

    def __init__(
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        store: ObjectStore,
        *,
        orphan_sweep_seconds: float = 43_200.0,
        work_root: Path | None = None,
        http_client: httpx2.AsyncClient | None = None,
        analytics_persons: AnalyticsPersons | None = None,
        settings: Settings,
    ) -> None:
        self._sessionmaker = sessionmaker
        # Without it, queued analytics deletions wait in their table until it is configured.
        self._analytics_persons = analytics_persons
        self._store = store
        self._ctx = JobContext(
            sessionmaker=sessionmaker,
            store=store,
            settings=settings,
            work_root=work_root,
            http_client=http_client,
        )
        self._orphan_sweep_seconds = orphan_sweep_seconds
        self._next_orphan_sweep = utc_now()
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

        While idle the only timer is the orphan sweep, every `orphan_sweep_seconds`, so
        the database and the host can both suspend between sweeps. A crash in one pass is
        logged and the loop continues.
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

        That is a backed-off or expired job or analytics deletion lock, an upload slot of a pending or
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
            deletion_due = (
                await analytics.next_due(session) if self._analytics_persons is not None else None
            )
        candidates = [self._next_orphan_sweep]
        candidates += [due for due in (job_due, deletion_due) if due is not None]
        candidates += [
            expiry + ABANDONED_SLOT_GRACE for expiry in slot_expiries if expiry is not None
        ]
        return min(candidates)

    async def run_once(self) -> int:
        """Run one job and one analytics deletion, purge deleted rows, and sweep orphans when due.

        Returns:
            int: How many units of work were done, so the loop knows whether to sleep.
        """
        done = 0
        job = await self._claim()
        if job is not None:
            await self._run_job(job)
            done += 1
        done += await self._purge()
        if self._analytics_persons is not None:
            done += await analytics.delete_due_person(self._sessionmaker, self._analytics_persons)
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
                .order_by(case((Job.kind.in_(_BACKGROUND_KINDS), 1), else_=0), Job.created_at)
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
        """Run a claimed job with its kind's handler, or give it up once out of attempts.

        A failing attempt records its own outcome, so a claim past MAX_ATTEMPTS means
        every attempt ended without one, as when an attempt takes the process down.
        """
        handler = HANDLERS[JobKind(job.kind)]
        if job.attempts > MAX_ATTEMPTS:
            await self._abandon(job)
            return
        try:
            await handler.run(self._ctx, job)
        except asyncio.CancelledError:
            await self._release_claim(job)
            raise

    async def _abandon(self, job: Job) -> None:
        """Drop a job whose attempts all ended without an outcome, after its kind's cleanup."""
        log.error(
            "%s gave up after attempts that never finished",
            job.kind,
            extra={"recording": str(job.recording_id), "attempt": job.attempts},
        )
        abandon = HANDLERS[JobKind(job.kind)].abandon
        async with self._sessionmaker() as session, session.begin():
            stored_job = await session.get(Job, job.id)
            if not still_claimed(stored_job, job):
                return
            if abandon is not None:
                await abandon(self._ctx, session, stored_job)
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
