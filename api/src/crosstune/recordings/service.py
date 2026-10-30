"""Queries and transitions shared by the recordings router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, overload

from sqlalchemy import case, text, update
from sqlalchemy.dialects.postgresql import insert

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.session import request_runner_wake
from crosstune.errors import ConflictError, NotFoundError
from crosstune.files.quota import used_bytes
from crosstune.jobs.attempt import held_after_failure
from crosstune.jobs.importer import OVER_QUOTA
from crosstune.links.detect import detect_provider
from crosstune.models import Job, Recording
from crosstune.recordings.split_rules import split_holds_original, split_ready_to_complete
from crosstune.recordings.trim_rules import needs_trim
from crosstune.storage.store import PLAYBACK_MIME
from crosstune.vocabulary import IMPORTABLE_PROVIDERS, JobKind

if TYPE_CHECKING:
    import uuid
    from collections.abc import Iterable

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.billing.access import Access
    from crosstune.config import Settings
    from crosstune.storage.store import Revision


# The recording error an import gets when its address is not on a host the server imports from.
NOT_IMPORTABLE = "Can't import from this address."


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


# Kinds a recording holds at most one of, each deduplicated against its partial unique index.
_SINGLE_KINDS = frozenset({JobKind.TRIM, JobKind.PLACE, JobKind.SPLIT})


@overload
async def enqueue_job(
    session: AsyncSession,
    recording: Recording,
    kind: Literal[JobKind.TRIM, JobKind.PLACE, JobKind.SPLIT],
) -> Job | None: ...
@overload
async def enqueue_job(
    session: AsyncSession,
    recording: Recording,
    kind: Literal[JobKind.TRANSCODE, JobKind.PEAKS, JobKind.IMPORT, JobKind.REENCODE],
) -> Job: ...
async def enqueue_job(session: AsyncSession, recording: Recording, kind: JobKind) -> Job | None:
    """Queue one job for the recording and wake the runner once the request commits.

    A trim, place, or split job is deduplicated against its `ux_jobs_recording_id_<kind>`
    index: a recording can have only one of each queued at a time, so a call while one
    is already pending inserts nothing.

    Args:
        session: The session to write through.
        recording: The recording the job is for.
        kind: What work the job asks the runner to do.

    Returns:
        Job | None: The queued row, or None when `kind` is TRIM, PLACE, or SPLIT and one was
            already pending.
    """
    request_runner_wake(session)
    if kind not in _SINGLE_KINDS:
        job = Job(recording_id=recording.id, user_id=recording.user_id, kind=kind.value)
        session.add(job)
        return job
    stmt = (
        insert(Job)
        .values(recording_id=recording.id, user_id=recording.user_id, kind=kind.value)
        .on_conflict_do_nothing(
            index_elements=[Job.recording_id], index_where=text(f"kind = '{kind.value}'")
        )
        .returning(Job)
    )
    result = await session.execute(stmt, execution_options={"populate_existing": True})
    job = result.scalar_one_or_none()
    if job is None and kind is JobKind.PLACE:
        # New coordinates start the pending lookup's clock over, and a lookup waiting out a
        # failure runs now. A claimed one keeps its lock, and re-queues itself if the
        # coordinates moved under it.
        await session.execute(
            update(Job)
            .where(Job.recording_id == recording.id, Job.kind == kind.value)
            .values(
                created_at=utc_now(),
                locked_until=case((held_after_failure(), None), else_=Job.locked_until),
            )
        )
    return job


async def enqueue_transcode(session: AsyncSession, recording: Recording) -> Job:
    """Add a transcode job for the recording and wake the runner once the request commits."""
    return await enqueue_job(session, recording, JobKind.TRANSCODE)


def importable(recording: Recording) -> bool:
    """Whether an import's `origin_url` is on the host its `origin` names, one we import from."""
    return (
        recording.origin in IMPORTABLE_PROVIDERS
        and detect_provider(recording.origin_url or "")[0] == recording.origin
    )


async def start_import(session: AsyncSession, recording: Recording, access: Access) -> None:
    """Queue the fetch of an import, or fail it at once when it can never be stored.

    An address that is not importable, or an account with no room left, fails the import
    without a fetch, so the server never downloads a file it would refuse. Takes a new
    server_seq for any change, so every device pulls the state set here. An import already
    failed for its address is left untouched.
    """
    if importable(recording):
        used = await used_bytes(session, recording.user_id, exclude=recording.id)
        if used < access.quota_bytes:
            recording.state = "processing"
            recording.error = None
            await enqueue_job(session, recording, JobKind.IMPORT)
        else:
            recording.state = "failed"
            recording.error = OVER_QUOTA
    elif (recording.state, recording.error) == ("failed", NOT_IMPORTABLE):
        return
    else:
        recording.state = "failed"
        recording.error = NOT_IMPORTABLE
    bump_server_seq(recording)


async def ensure_trim_job(session: AsyncSession, recording: Recording) -> None:
    """Queue a trim job when the recording's playback file no longer matches its saved trim.

    A soft-deleted recording never gets one: the purge sweep owns its files. Neither does
    a parent whose original a waiting piece still needs; the split job queues the trim
    once no piece waits.
    """
    if (
        recording.deleted_at is None
        and needs_trim(recording)
        and not await split_holds_original(session, recording)
    ):
        await enqueue_job(session, recording, JobKind.TRIM)


async def ensure_split_job(session: AsyncSession, parent: Recording) -> None:
    """Queue the parent's split job when it is ready and its split has work left.

    The work is a live piece of any of its splits awaiting its cut, or a latest split
    whose pieces are all cut but which is not yet recorded as completed.
    """
    if parent.state != "ready" or parent.split_id is None:
        return
    if await split_holds_original(session, parent) or await split_ready_to_complete(
        session, parent
    ):
        await enqueue_job(session, parent, JobKind.SPLIT)


async def ensure_split_jobs(session: AsyncSession, parent_ids: Iterable[uuid.UUID | None]) -> None:
    """Queue the split job of each listed recording that has split work left, once each."""
    for parent_id in {parent_id for parent_id in parent_ids if parent_id is not None}:
        parent = await session.get(Recording, parent_id)
        if parent is not None:
            await ensure_split_job(session, parent)


async def ensure_place_job(session: AsyncSession, recording: Recording) -> None:
    """Queue a place job when the recording has coordinates that have no name yet."""
    if (
        recording.deleted_at is None
        and recording.place_lat is not None
        and recording.place_name is None
    ):
        await enqueue_job(session, recording, JobKind.PLACE)


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


def max_upload_bytes(recording: Recording, settings: Settings) -> int:
    """The per-file cap for a recording's upload.

    A split parent is held on its device until split, so its whole long original is the
    file it uploads; every other recording keeps the plain cap.
    """
    if recording.split_size is not None:
        return settings.recording_split_parent_max_file_bytes
    return settings.recording_max_file_bytes


def require_state(recording: Recording, *expected: str) -> None:
    """Raise a conflict naming the recording's actual state when it is not one of the expected.

    Args:
        recording: The recording to check.
        expected: The states the caller's operation allows.
    """
    if recording.state not in expected:
        msg = f"Recording is {recording.state}, not {' or '.join(expected)}"
        raise ConflictError(msg)
