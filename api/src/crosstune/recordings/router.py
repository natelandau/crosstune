"""Presigned uploads and downloads, and the state changes around them."""

from __future__ import annotations

import uuid  # noqa: TC003 -- FastAPI resolves path parameter annotations at runtime
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 -- FastAPI resolves this annotation at route registration
)

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.locks import lock_user
from crosstune.db.session import get_session
from crosstune.errors import (
    AppError,
    ConflictError,
    FileTooLargeError,
    QuotaExceededError,
    problem_responses,
)
from crosstune.models import UploadSlot
from crosstune.models.user import utc_now
from crosstune.recordings.service import (
    bump_server_seq,
    enqueue_transcode,
    owned_recording,
    require_state,
    slot_for,
    used_bytes,
)
from crosstune.storage.store import upload_key

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectStore

router = APIRouter(prefix="/v1/recordings", tags=["recordings"])

UPLOAD_URL_TTL_SECONDS = 3600
DOWNLOAD_URL_TTL_SECONDS = 3600
# An upload may differ slightly from the size the client declared; past this it is refused.
UPLOAD_SIZE_TOLERANCE = 0.05
# A recording may ask for a slot before its first upload and after one that failed.
SLOT_STATES = ("pending_upload", "failed")
# States that mean an earlier confirmation was accepted, so a repeat of it changes nothing.
CONFIRMED_STATES = ("uploaded", "processing", "ready")


class UploadSlotRequest(BaseModel):
    """What the client is about to upload."""

    bytes: int = Field(gt=0)
    # Parameters are part of what the browser sends, as in `audio/webm;codecs=opus`,
    # and the signature must cover the whole header for the PUT to be accepted.
    content_type: str = Field(
        pattern=r"^audio/[A-Za-z0-9.+_-]+(;[A-Za-z0-9.+_=\- ]+)*$", max_length=100
    )


class SignedUrl(BaseModel):
    """A presigned URL and when it stops working."""

    url: str
    expires_at: datetime


class StorageUnavailableError(AppError):
    """No object store is configured, so uploads and downloads cannot be served."""

    def __init__(self) -> None:
        super().__init__(503, "Service Unavailable", "Recording storage is not configured")


def require_store(request: Request) -> ObjectStore:
    """The app's object store, or a 503 when the deployment has none."""
    store = request.app.state.object_store
    if store is None:
        raise StorageUnavailableError
    return store


@router.post("/{recording_id}/upload-slot", responses=problem_responses(404, 409, 413, 503))
async def upload_slot(
    recording_id: uuid.UUID,
    body: UploadSlotRequest,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SignedUrl:
    """A presigned PUT for one recording's file, once the quota allows it.

    A failed recording is issued a slot too, and returns to pending_upload: it is
    the only way back for one whose uploaded object is no longer in the bucket.
    """
    store = require_store(request)
    settings = request.app.state.settings
    await lock_user(session, user.id)
    recording = await owned_recording(session, user.id, recording_id)
    if recording.state not in SLOT_STATES:
        msg = f"Recording is {recording.state}, not {' or '.join(SLOT_STATES)}"
        raise ConflictError(msg)
    if body.bytes > settings.recording_max_file_bytes:
        msg = f"Files are limited to {settings.recording_max_file_bytes} bytes"
        raise FileTooLargeError(msg)

    now = utc_now()
    existing = await slot_for(session, recording.id)
    # Reissuing replaces the declared size, so the old reservation must not double count.
    reserved = existing.declared_bytes if existing and existing.expires_at > now else 0
    used = await used_bytes(session, user.id, now) - reserved
    if used + body.bytes > settings.recording_quota_bytes:
        msg = f"{used} of {settings.recording_quota_bytes} bytes used"
        raise QuotaExceededError(msg)

    expires_at = now + timedelta(seconds=UPLOAD_URL_TTL_SECONDS)
    if existing is None:
        session.add(
            UploadSlot(
                recording_id=recording.id,
                user_id=user.id,
                declared_bytes=body.bytes,
                content_type=body.content_type,
                expires_at=expires_at,
            )
        )
    else:
        existing.declared_bytes = body.bytes
        existing.content_type = body.content_type
        existing.expires_at = expires_at
    if recording.state == "failed":
        recording.state = "pending_upload"
        recording.error = None
        bump_server_seq(recording)
    await session.flush()
    url = store.presign_put(
        upload_key(user.id, recording.id), body.content_type, UPLOAD_URL_TTL_SECONDS
    )
    return SignedUrl(url=url, expires_at=expires_at)


@router.post(
    "/{recording_id}/uploaded", status_code=204, responses=problem_responses(404, 409, 413, 503)
)
async def upload_finished(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Confirm the object landed and queue its transcode. Repeating the call changes nothing."""
    store = require_store(request)
    settings = request.app.state.settings
    key = upload_key(user.id, recording_id)
    recording = await owned_recording(session, user.id, recording_id)
    # The bucket round trip happens before the lock so it never holds up the caller's other writes.
    info = await store.head(key)
    await lock_user(session, user.id)
    # Re-read under the lock: another request may have confirmed or failed this recording meanwhile.
    await session.refresh(recording)
    slot = await slot_for(session, recording.id)
    if recording.state in CONFIRMED_STATES and slot is None:
        # A retried call after a lost response: the first one consumed the slot
        # and queued the job.
        return Response(status_code=204)
    require_state(recording, "pending_upload")
    if slot is None or slot.expires_at <= utc_now():
        msg = "No open upload slot; request a new one"
        raise ConflictError(msg)
    if info is None:
        msg = "No file was uploaded"
        raise ConflictError(msg)
    if info.size > settings.recording_max_file_bytes:
        await store.delete(key)
        msg = f"Files are limited to {settings.recording_max_file_bytes} bytes"
        raise FileTooLargeError(msg)
    if info.size > slot.declared_bytes * (1 + UPLOAD_SIZE_TOLERANCE):
        await store.delete(key)
        msg = f"Uploaded {info.size} bytes but declared {slot.declared_bytes}"
        raise QuotaExceededError(msg)

    recording.state = "uploaded"
    # The upload counts against quota from this moment; the transcoder replaces the figure.
    recording.playback_bytes = info.size
    await session.delete(slot)
    bump_server_seq(recording)
    enqueue_transcode(session, recording)
    await session.flush()
    return Response(status_code=204)


@router.post("/{recording_id}/retry", status_code=204, responses=problem_responses(404, 409))
async def retry(
    recording_id: uuid.UUID,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> Response:
    """Transcode the object already in the bucket again, for a recording that failed.

    A recording whose uploaded object is gone is uploaded again through a new
    slot instead; this route only re-runs the transcode.
    """
    await lock_user(session, user.id)
    recording = await owned_recording(session, user.id, recording_id)
    require_state(recording, "failed")
    recording.state = "uploaded"
    recording.error = None
    bump_server_seq(recording)
    enqueue_transcode(session, recording)
    await session.flush()
    return Response(status_code=204)


@router.get("/{recording_id}/download", responses=problem_responses(404, 409, 503))
async def download(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> SignedUrl:
    """A presigned GET for the playback file of a ready recording."""
    store = require_store(request)
    recording = await owned_recording(session, user.id, recording_id)
    require_state(recording, "ready")
    if recording.playback_key is None:
        msg = "Recording has no playback file"
        raise ConflictError(msg)
    url = store.presign_get(recording.playback_key, DOWNLOAD_URL_TTL_SECONDS)
    return SignedUrl(url=url, expires_at=utc_now() + timedelta(seconds=DOWNLOAD_URL_TTL_SECONDS))
