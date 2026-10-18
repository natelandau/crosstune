"""Claims queued jobs one at a time and sweeps deleted files and abandoned uploads."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import and_, case, func, or_, select, update

from crosstune.billing.notices import RUN_EVERY as BILLING_NOTICES_EVERY
from crosstune.billing.notices import (
    claim_billing_notices_run,
    next_billing_notices_run,
    run_billing_notices,
)
from crosstune.billing.withdrawal import complete_pending_withdrawals
from crosstune.db.base import utc_now
from crosstune.inactivity.sweep import (
    RUN_EVERY,
    claim_inactivity_run,
    next_inactivity_run,
    run_inactivity,
)
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
    from crosstune.billing.revenuecat import RevenueCat
    from crosstune.billing.stripe import StripeSubscriptions
    from crosstune.config import Settings
    from crosstune.email.resend import Mailer
    from crosstune.storage.store import ObjectStore
    from crosstune.users.clerk import ClerkUsers

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

    def __init__(  # noqa: PLR0913 -- the optional clients are keyword-only
        self,
        sessionmaker: async_sessionmaker[AsyncSession],
        store: ObjectStore,
        *,
        orphan_sweep_seconds: float | None = 43_200.0,
        work_root: Path | None = None,
        http_client: httpx2.AsyncClient | None = None,
        analytics_persons: AnalyticsPersons | None = None,
        mailer: Mailer | None = None,
        clerk_users: ClerkUsers | None = None,
        stripe: StripeSubscriptions | None = None,
        revenuecat: RevenueCat | None = None,
        settings: Settings,
    ) -> None:
        self._sessionmaker = sessionmaker
        self._settings = settings
        # Without both, no account can be warned, so the inactivity pass never runs and
        # nothing is ever deleted for inactivity.
        self._warning_clients: tuple[Mailer, ClerkUsers] | None = (
            (mailer, clerk_users) if mailer is not None and clerk_users is not None else None
        )
        # Read from the database once, then moved on by each claim, so an idle loop
        # writes nothing until the pass falls due.
        self._inactivity_due: datetime | None = None
        self.inactivity_task: asyncio.Task[None] | None = None
        # The daily billing pass finishes stuck withdrawals, which needs Stripe and
        # RevenueCat, and sends billing notices, which needs mail. It runs while either can.
        self._mailer = mailer
        self._withdrawal_clients: tuple[StripeSubscriptions, RevenueCat] | None = (
            (stripe, revenuecat) if stripe is not None and revenuecat is not None else None
        )
        self._billing_notices_due: datetime | None = None
        self.billing_notices_task: asyncio.Task[None] | None = None
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
        # None turns sweeps off, for a one-off runner that needs only its own jobs: a
        # sweep lists the whole bucket.
        self._orphan_sweep_seconds = orphan_sweep_seconds
        self._next_orphan_sweep = (
            utc_now() if orphan_sweep_seconds is not None else datetime.max.replace(tzinfo=UTC)
        )
        self._stopping = asyncio.Event()
        self._wake = asyncio.Event()
        self.task: asyncio.Task[None] | None = None

    def start(self) -> asyncio.Task[None]:
        """Run the loop as a task on the current event loop."""
        self.task = asyncio.create_task(self.run_forever(), name="job-runner")
        return self.task

    async def stop(self) -> None:
        """Ask the loop to finish its current job and the inactivity pass, waiting only so long.

        A job cancelled at the deadline hands its claim straight back, uncounted, so
        the next process retries it without waiting out the lock. A recording it
        moved to processing stays there until that retry. An inactivity pass cancelled
        at the deadline rolls back the account it was on, and the next pass takes it
        up again.
        """
        self._stopping.set()
        self._wake.set()
        deadline = asyncio.get_running_loop().time() + STOP_TIMEOUT_SECONDS
        if self.task is not None:
            await _finish_by(self.task, deadline)
        if self.inactivity_task is not None:
            await _finish_by(self.inactivity_task, deadline)
        if self.billing_notices_task is not None:
            await _finish_by(self.billing_notices_task, deadline)

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

        That is a backed-off or expired job or analytics deletion lock, an upload slot of a
        pending or deleted row passing its abandonment grace, the daily inactivity and billing
        passes, or the next orphan sweep, which bounds the sleep to `orphan_sweep_seconds`.
        Other purges have no due time; the delete that makes one wakes the runner.

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
        # A running pass wakes the loop when it ends, so it sets no due time of its own.
        inactivity_due = (
            await self._inactivity_due_at(utc_now())
            if self._warning_clients is not None and not self._inactivity_running()
            else None
        )
        billing_due = (
            await self._billing_notices_due_at(utc_now())
            if self._billing_enabled() and not self._billing_notices_running()
            else None
        )
        candidates = [self._next_orphan_sweep]
        candidates += [
            due for due in (job_due, deletion_due, inactivity_due, billing_due) if due is not None
        ]
        candidates += [
            expiry + ABANDONED_SLOT_GRACE for expiry in slot_expiries if expiry is not None
        ]
        return min(candidates)

    async def run_once(self) -> int:
        """Run one job and one analytics deletion, purge deleted rows, and run due periodic passes.

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
        done += await self._start_inactivity()
        done += await self._start_billing_notices()
        # Last, so a bucket listing that fails cannot starve the transcodes and purges.
        if self._orphan_sweep_seconds is not None and utc_now() >= self._next_orphan_sweep:
            self._next_orphan_sweep = utc_now() + timedelta(seconds=self._orphan_sweep_seconds)
            done += await self.sweep_orphans()
        return done

    async def _inactivity_due_at(self, now: datetime) -> datetime:
        """When this process next tries to claim the inactivity pass; `now` if it never ran."""
        if self._inactivity_due is None:
            async with self._sessionmaker() as session:
                self._inactivity_due = await next_inactivity_run(session) or now
        return self._inactivity_due

    async def _start_inactivity(self) -> int:
        """Start the inactivity pass as its own task when it is due and this process claims it.

        The pass makes a Clerk lookup and a Resend send per account, so it runs beside
        the loop rather than in it, one at a time, and queued jobs never wait on it.

        Returns:
            int: 1 when this call started the pass, else 0.
        """
        if self._warning_clients is None or self._stopping.is_set() or self._inactivity_running():
            return 0
        now = utc_now()
        if now < await self._inactivity_due_at(now):
            return 0
        if not await claim_inactivity_run(self._sessionmaker, now):
            # Another process claimed it; read the due time that claim stored.
            self._inactivity_due = None
            return 0
        self._inactivity_due = now + RUN_EVERY
        mailer, clerk_users = self._warning_clients
        self.inactivity_task = asyncio.create_task(
            self._run_inactivity(mailer, clerk_users, now), name="inactivity-pass"
        )
        return 1

    def _inactivity_running(self) -> bool:
        return self.inactivity_task is not None and not self.inactivity_task.done()

    async def _run_inactivity(self, mailer: Mailer, clerk_users: ClerkUsers, now: datetime) -> None:
        """Run one claimed inactivity pass, then wake the loop to purge what it deleted."""
        try:
            await run_inactivity(
                self._sessionmaker, mailer, clerk_users, self._settings, now, clock=utc_now
            )
        except Exception:
            log.exception("inactivity pass failed")
        self.wake()

    def _billing_enabled(self) -> bool:
        return self._mailer is not None or self._withdrawal_clients is not None

    def _billing_notices_running(self) -> bool:
        return self.billing_notices_task is not None and not self.billing_notices_task.done()

    async def _billing_notices_due_at(self, now: datetime) -> datetime:
        """When this process next tries to claim the billing pass; `now` if it never ran."""
        if self._billing_notices_due is None:
            async with self._sessionmaker() as session:
                self._billing_notices_due = await next_billing_notices_run(session) or now
        return self._billing_notices_due

    async def _start_billing_notices(self) -> int:
        """Start the daily billing pass as its own task when it is due and this process claims it.

        Returns:
            int: 1 when this call started the pass, else 0.
        """
        if (
            not self._billing_enabled()
            or self._stopping.is_set()
            or self._billing_notices_running()
        ):
            return 0
        now = utc_now()
        if now < await self._billing_notices_due_at(now):
            return 0
        if not await claim_billing_notices_run(self._sessionmaker, now):
            self._billing_notices_due = None
            return 0
        self._billing_notices_due = now + BILLING_NOTICES_EVERY
        self.billing_notices_task = asyncio.create_task(
            self._run_billing_notices(now), name="billing-notices-pass"
        )
        return 1

    async def _run_billing_notices(self, now: datetime) -> None:
        """Finish pending withdrawals, then send owed billing notices, then wake the loop.

        One part failing never skips the other. The wake lets the idle loop read the next
        due time, which `next_due` leaves out while the pass runs.
        """
        try:
            if self._withdrawal_clients is not None:
                stripe, revenuecat = self._withdrawal_clients
                try:
                    await complete_pending_withdrawals(
                        self._sessionmaker, stripe, revenuecat, self._mailer, self._settings, now
                    )
                except Exception:
                    log.exception("completing pending withdrawals failed")
            if self._mailer is not None:
                try:
                    await run_billing_notices(self._sessionmaker, self._mailer, self._settings, now)
                except Exception:
                    log.exception("billing notices pass failed")
        finally:
            self.wake()

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


async def _finish_by(task: asyncio.Task[None], deadline: float) -> None:
    """Wait for the task until the loop clock reaches `deadline`, then cancel it.

    Never raises for the task's own outcome, so one task's failure or cancellation
    cannot keep the caller from finishing the next.
    """
    try:
        if not task.done():
            try:
                async with asyncio.timeout_at(deadline):
                    await asyncio.shield(task)
            except TimeoutError:
                task.cancel()
        # A done task returns at once; one cancelled at the deadline is awaited here.
        await task
    except asyncio.CancelledError:
        # Raised by a cancelled task, but also when stop() itself is cancelled.
        if not task.cancelled():
            raise
    except Exception:
        log.exception("job runner task failed", extra={"task": task.get_name()})
