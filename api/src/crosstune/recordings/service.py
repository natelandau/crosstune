"""Queries and transitions shared by the recordings router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, overload

from sqlalchemy import func, select, text
from sqlalchemy.dialects.postgresql import insert

from crosstune.db.base import next_server_seq
from crosstune.db.session import request_runner_wake
from crosstune.errors import ConflictError, NotFoundError
from crosstune.models import Job, Recording, UploadSlot
from crosstune.models.user import utc_now
from crosstune.recordings.trim import needs_trim
from crosstune.storage.store import PLAYBACK_MIME
from crosstune.vocabulary import JobKind

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.storage.store import Revision


async def used_bytes(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime | None = None,
    *,
    exclude: uuid.UUID | None = None,
) -> int:
    """The bytes that count against a user's quota.

    A live recording counts its open upload slot's declared size when it has one,
    otherwise its playback bytes. The slot stands in for, never adds to, the object
    already at the upload key: the PUT it signs overwrites that object, and once the
    slot expires unused the object is still there and counts again.

    Args:
        session: The session to query through.
        user_id: Whose storage to sum.
        now: The moment that decides whether a slot is still open. Defaults to the clock.
        exclude: A recording to leave out, for a caller sizing that recording's own upload.

    Returns:
        int: The bytes that count against the user's quota.
    """
    now = now or utc_now()
    open_slots = select(UploadSlot.recording_id).where(
        UploadSlot.user_id == user_id, UploadSlot.expires_at > now
    )
    live = [Recording.user_id == user_id, Recording.deleted_at.is_(None)]
    if exclude is not None:
        live.append(Recording.id != exclude)
    stored = await session.scalar(
        select(func.coalesce(func.sum(Recording.playback_bytes), 0)).where(
            *live, Recording.id.not_in(open_slots)
        )
    )
    reserved = await session.scalar(
        select(func.coalesce(func.sum(UploadSlot.declared_bytes), 0))
        .join(Recording, Recording.id == UploadSlot.recording_id)
        .where(*live, UploadSlot.expires_at > now)
    )
    return int(stored or 0) + int(reserved or 0)


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


async def slot_for(session: AsyncSession, recording_id: uuid.UUID) -> UploadSlot | None:
    """The upload slot of a recording, expired or not. Callers check `expires_at`."""
    return await session.get(UploadSlot, recording_id)


@overload
async def enqueue_job(
    session: AsyncSession, recording: Recording, kind: Literal[JobKind.TRIM]
) -> Job | None: ...
@overload
async def enqueue_job(
    session: AsyncSession, recording: Recording, kind: Literal[JobKind.TRANSCODE, JobKind.PEAKS]
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
