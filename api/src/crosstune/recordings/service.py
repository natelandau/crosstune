"""Queries and transitions shared by the recordings router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

from crosstune.db.base import next_server_seq
from crosstune.errors import ConflictError, NotFoundError
from crosstune.models import Job, Recording, UploadSlot
from crosstune.models.user import utc_now

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession


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


def enqueue_transcode(session: AsyncSession, recording: Recording) -> Job:
    """Add a transcode job for the recording. The runner picks it up on its next poll."""
    job = Job(recording_id=recording.id, user_id=recording.user_id)
    session.add(job)
    return job


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
