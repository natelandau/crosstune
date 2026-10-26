"""One handler per job kind: what an attempt runs, and how a job that never finished gives up."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from crosstune.jobs.attempt import fail_abandoned_recording
from crosstune.jobs.handlers import imports, peaks, place, reencode, transcode, trim
from crosstune.jobs.recovery import release_backup_copy
from crosstune.vocabulary import JobKind

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext
    from crosstune.models import Job


@dataclass(frozen=True)
class JobHandler:
    """How the runner treats one job kind."""

    run: Callable[[JobContext, Job], Awaitable[None]]
    # Runs under the job's claim, in a transaction, for a job whose attempts all ended
    # without recording an outcome, as when one takes the process down with it.
    abandon: Callable[[JobContext, AsyncSession, Job], Awaitable[object]] | None = None
    # A background kind waits behind every other, so it never delays a new recording or a trim.
    background: bool = False


HANDLERS: dict[JobKind, JobHandler] = {
    JobKind.TRANSCODE: JobHandler(run=transcode.run, abandon=fail_abandoned_recording),
    JobKind.PEAKS: JobHandler(run=peaks.run),
    JobKind.TRIM: JobHandler(run=trim.run, abandon=release_backup_copy),
    JobKind.IMPORT: JobHandler(run=imports.run, abandon=fail_abandoned_recording),
    JobKind.REENCODE: JobHandler(run=reencode.run, background=True),
    JobKind.PLACE: JobHandler(run=place.run, background=True),
}
