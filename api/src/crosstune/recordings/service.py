"""Queries and transitions shared by the recordings router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, overload

from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

from crosstune.db.base import next_server_seq
from crosstune.db.session import request_runner_wake
from crosstune.errors import ConflictError, NotFoundError
from crosstune.jobs.importer import NOT_IMPORTABLE
from crosstune.links.detect import detect_provider
from crosstune.models import Job, Recording
from crosstune.recordings.trim import needs_trim
from crosstune.storage.store import PLAYBACK_MIME
from crosstune.vocabulary import IMPORTABLE_PROVIDERS, JobKind

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.storage.store import Revision


async def owned_recording(
    session: AsyncSession, user_id: uuid.UUID, recording_id: uuid.UUID
) -> Recording:
    """The caller's live recording, or a 404 that does not reveal whether the id exists.

    Args:
        session: The session to query through.
        user_id: The caller.
        recording_id: The recording named in the URL.

    Returns:
        Recording: The row.
    """
    row = await session.get(Recording, recording_id)
    if row is None or row.user_id != user_id or row.deleted_at is not None:
        raise NotFoundError
    return row


@overload
async def enqueue_job(
    session: AsyncSession, recording: Recording, kind: Literal[JobKind.TRIM]
) -> Job | None: ...
@overload
async def enqueue_job(
    session: AsyncSession,
    recording: Recording,
    kind: Literal[JobKind.TRANSCODE, JobKind.PEAKS, JobKind.IMPORT, JobKind.REENCODE],
) -> Job: ...
async def enqueue_job(session: AsyncSession, recording: Recording, kind: JobKind) -> Job | None:
    """Queue one job for the recording and wake the runner once the request commits.

    A trim is deduplicated against `ux_jobs_recording_id_trim`: a recording can have
    only one trim queued at a time, so a call while one is already pending inserts
    nothing.

    Args:
        session: The session to write through.
        recording: The recording the job is for.
        kind: What work the job asks the runner to do.

    Returns:
        Job | None: The queued row, or None when `kind` is TRIM and one was already pending.
    """
    request_runner_wake(session)
    if kind is not JobKind.TRIM:
        job = Job(recording_id=recording.id, user_id=recording.user_id, kind=kind.value)
        session.add(job)
        return job
    stmt = (
        insert(Job)
        .values(recording_id=recording.id, user_id=recording.user_id, kind=kind.value)
        .on_conflict_do_nothing(
            index_elements=[Job.recording_id], index_where=text(f"kind = '{JobKind.TRIM.value}'")
        )
        .returning(Job)
    )
    result = await session.execute(stmt, execution_options={"populate_existing": True})
    return result.scalar_one_or_none()


async def enqueue_transcode(session: AsyncSession, recording: Recording) -> Job:
    """Add a transcode job for the recording and wake the runner once the request commits."""
    return await enqueue_job(session, recording, JobKind.TRANSCODE)


def importable(recording: Recording) -> bool:
    """Whether an import's `origin_url` is on the host its `origin` names, one we import from."""
    return (
        recording.origin in IMPORTABLE_PROVIDERS
        and detect_provider(recording.origin_url or "")[0] == recording.origin
    )


async def start_import(session: AsyncSession, recording: Recording) -> None:
    """Queue the fetch of an import, or fail it at once when its address is not importable.

    Takes a new server_seq for any change, so every device pulls the state set here. An
    import already failed for its address is left untouched.
    """
    if importable(recording):
        recording.state = "processing"
        recording.error = None
        await enqueue_job(session, recording, JobKind.IMPORT)
    elif (recording.state, recording.error) == ("failed", NOT_IMPORTABLE):
        return
    else:
        recording.state = "failed"
        recording.error = NOT_IMPORTABLE
    bump_server_seq(recording)


async def ensure_trim_job(session: AsyncSession, recording: Recording) -> None:
    """Queue a trim job when the recording's playback file no longer matches its saved trim.

    A soft-deleted recording never gets one: the purge sweep owns its files.
    """
    if recording.deleted_at is None and needs_trim(recording):
        await enqueue_job(session, recording, JobKind.TRIM)


def attach_playback(
    recording: Recording, playback: Revision, *, duration_ms: int, start_ms: int, end_ms: int
) -> None:
    """Point the row at a new playback file covering `start_ms` to `end_ms` of the source."""
    recording.playback_key = playback.key
    recording.playback_rev = playback.rev
    recording.playback_bytes = playback.size
    recording.playback_mime = PLAYBACK_MIME
    recording.duration_ms = duration_ms
    recording.playback_start_ms = start_ms
    recording.playback_end_ms = end_ms


def attach_peaks(recording: Recording, peaks: Revision) -> None:
    """Point the row at a new waveform peaks file."""
    recording.peaks_key = peaks.key
    recording.peaks_rev = peaks.rev
    recording.peaks_bytes = peaks.size


def bump_server_seq(recording: Recording) -> None:
    """Take a new server_seq so every device pulls the change. updated_at stays the client's."""
    recording.server_seq = next_server_seq()


def require_state(recording: Recording, *expected: str) -> None:
    """Raise a conflict naming the recording's actual state when it is not one of the expected.

    Args:
        recording: The recording to check.
        expected: The states the caller's operation allows.
    """
    if recording.state not in expected:
        msg = f"Recording is {recording.state}, not {' or '.join(expected)}"
        raise ConflictError(msg)
