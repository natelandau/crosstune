"""Presigned uploads and downloads, and the state changes around them."""

from __future__ import annotations

import logging
import secrets
import uuid  # noqa: TC003 -- FastAPI resolves path parameter annotations at runtime
from datetime import datetime
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, BackgroundTasks, Header, Request, Response
from pydantic import BaseModel, Field

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.billing.access import access_for
from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.locks import lock_user
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import (
    ConflictError,
    NotFoundError,
    PremiumRequiredError,
    QuotaExceededError,
    TooManyRequestsError,
    problem_responses,
)
from crosstune.files.quota import (
    OVER_QUOTA,
    accept_upload,
    confirm_token_hash,
    head_slot,
    reserve_slot,
    slot_for_recording,
    token_matches,
)
from crosstune.files.urls import UPLOAD_URL_TTL_SECONDS, SignedUrl, presign_get, require_store
from crosstune.models import Recording
from crosstune.ratelimit import account_slot
from crosstune.recordings.service import (
    enqueue_transcode,
    ensure_split_job,
    max_upload_bytes,
    owned_recording,
    require_state,
    reread_live,
    start_import,
)
from crosstune.storage.store import delete_best_effort, upload_key

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/recordings", tags=["recordings"])

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


class UploadSlotGrant(SignedUrl):
    """A presigned PUT, and the token that confirms it without sign-in until the URL expires."""

    confirm_token: str


class DownloadUrl(BaseModel):
    """A presigned GET for the playback file, tagged with the revision and start it was signed for."""

    url: str
    expires_at: datetime
    playback_rev: str
    playback_start_ms: int


class PeaksUrl(BaseModel):
    """A presigned GET for the waveform file, tagged with the revision it was signed for."""

    url: str
    expires_at: datetime
    peaks_rev: str


@router.post(
    "/{recording_id}/upload-slot", responses=problem_responses(403, 404, 409, 413, 429, 503)
)
async def upload_slot(
    recording_id: uuid.UUID,
    body: UploadSlotRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> UploadSlotGrant:
    """A presigned PUT for one recording's file, once the plan and its quota allow it.

    A failed recording is issued a slot too, and returns to pending_upload: it is
    the only way back for one whose uploaded object is no longer in the bucket. Each
    issue carries a new confirm token for `uploaded-with-token`; only its hash is stored.
    """
    store = require_store(request)
    settings = request.app.state.settings
    # Ownership first, so an id that is not the caller's never waits on the lock.
    recording = await owned_recording(session, user.id, recording_id)
    token = secrets.token_urlsafe(32)
    with account_slot(request, user.id):
        await lock_user(session, user.id, wait_seconds=settings.request_lock_timeout_seconds)
        await reread_live(session, recording)
        require_state(recording, *SLOT_STATES)
        access = await access_for(session, user.id, settings)
        if not access.premium:
            raise PremiumRequiredError
        slot = await reserve_slot(
            session,
            recording,
            declared_bytes=body.bytes,
            content_type=body.content_type,
            max_file_bytes=max_upload_bytes(recording, settings),
            quota_bytes=access.quota_bytes,
            token_hash=confirm_token_hash(token),
        )
        if recording.state == "failed":
            # playback_bytes stays: it is the object still at the upload key, which counts
            # again if this slot expires unused and is replaced once the new PUT is confirmed.
            recording.state = "pending_upload"
            recording.error = None
            bump_server_seq(recording)
        await session.flush()
    url = store.presign_put(slot.object_key, body.content_type, body.bytes, UPLOAD_URL_TTL_SECONDS)
    return UploadSlotGrant(url=url, expires_at=slot.expires_at, confirm_token=token)


@router.post(
    "/{recording_id}/uploaded",
    status_code=204,
    responses=problem_responses(404, 409, 413, 429, 503),
)
async def upload_finished(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
    background: BackgroundTasks,
) -> Response:
    """Confirm the object landed and queue its transcode. Repeating the call changes nothing."""
    recording = await owned_recording(session, user.id, recording_id)
    await confirm_upload(request, session, background, recording, user_id=user.id)
    return Response(status_code=204)


@router.post(
    "/{recording_id}/uploaded-with-token",
    status_code=204,
    responses=problem_responses(404, 409, 413, 429, 503),
)
async def uploaded_with_token(
    recording_id: uuid.UUID,
    request: Request,
    session: DbSession,
    background: BackgroundTasks,
    x_upload_token: Annotated[str | None, Header()] = None,
) -> Response:
    """Confirm an upload with the slot's confirm token in place of a bearer token.

    Besides the webhooks, the one `/v1` route that takes no bearer token: the web app's
    service worker finishes an upload after its tab closes, and the worker cannot sign
    in. The token is good for one recording's open slot, and the route does only what
    `uploaded` does, as the slot's owner. Every token or recording problem is the same
    404, so the route never reveals whether a recording exists.
    """
    # Per recording, since the caller is not signed in and a client address is shared by
    # every caller behind the Worker and can be forged by a direct one.
    wait = request.app.state.upload_token_limiter.hit(recording_id)
    if wait is not None:
        raise TooManyRequestsError(wait)
    recording = await session.get(Recording, recording_id)
    slot = await slot_for_recording(session, recording_id)
    presented_hash = None if x_upload_token is None else confirm_token_hash(x_upload_token)
    if (
        presented_hash is None
        or recording is None
        or recording.deleted_at is not None
        or slot is None
        or slot.expires_at <= utc_now()
        or not token_matches(slot, presented_hash)
    ):
        raise NotFoundError
    await confirm_upload(
        request,
        session,
        background,
        recording,
        user_id=recording.user_id,
        expected_token_hash=presented_hash,
    )
    return Response(status_code=204)


async def confirm_upload(
    request: Request,
    session: AsyncSession,
    background: BackgroundTasks,
    recording: Recording,
    *,
    user_id: uuid.UUID,
    expected_token_hash: str | None = None,
) -> None:
    """Confirm the object landed under the recording's slot and queue its transcode.

    Repeating it after a confirmation changes nothing.

    Args:
        request: The request, for the store, the settings, and the account's limits.
        session: The session to write through.
        background: Where the staged object's delete is queued, to run after the commit.
        recording: The live recording, already checked to belong to `user_id`.
        user_id: The recording's owner, whose lock the confirmation holds.
        expected_token_hash: For a confirm by token, the hash of the slot it was checked
            against. A slot reissued since then is the same 404 as a wrong token.
    """
    store = require_store(request)
    settings = request.app.state.settings
    with account_slot(request, user_id):
        # The bucket round trip happens before the lock so it never holds up the caller's
        # other writes, and inside the slot so a busy account is refused before it.
        info = await head_slot(store, await slot_for_recording(session, recording.id))
        await lock_user(session, user_id, wait_seconds=settings.request_lock_timeout_seconds)
        # Another request may have confirmed, failed, or deleted this recording meanwhile.
        await reread_live(session, recording)
        slot = await slot_for_recording(session, recording.id)
        if recording.state in CONFIRMED_STATES and slot is None:
            # A retried call after a lost response: the first one consumed the slot
            # and queued the job.
            return
        if expected_token_hash is not None:
            if slot is not None:
                # The session's identity map holds the slot as read before the lock.
                await session.refresh(slot)
            if not token_matches(slot, expected_token_hash):
                raise NotFoundError
        require_state(recording, "pending_upload")
        target = upload_key(user_id, recording.id)
        size = await accept_upload(
            session,
            store,
            slot,
            info,
            target=target,
            max_file_bytes=max_upload_bytes(recording, settings),
        )
        # A slot whose key is the target holds the confirmed file, so only a staged key is
        # deleted.
        staged = slot.object_key if slot is not None and slot.object_key != target else None

        recording.state = "uploaded"
        # The upload counts against quota from this moment; the transcoder replaces the figure.
        recording.playback_bytes = size
        await session.delete(slot)
        bump_server_seq(recording)
        await enqueue_transcode(session, recording)
        await session.flush()
    # After the commit, so the bucket call never holds the user's lock; a leftover is a
    # stray the orphan sweep removes.
    background.add_task(
        delete_best_effort, store, [staged], log=log, message="could not delete a staged upload"
    )


@router.post(
    "/{recording_id}/retry",
    status_code=204,
    responses=problem_responses(403, 404, 409, 413, 429, 503),
)
async def retry(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> Response:
    """Process a failed recording again: transcode its file, cut a piece, or fetch an import.

    A piece of a split that was never cut goes back to its parent's split job, or is a
    conflict once the parent no longer holds its audio. An import whose file never
    arrived is fetched again, or fails at once when its address is not one the server
    imports from. Any other recording whose uploaded object is gone is uploaded again
    through a new slot; this route only re-runs the transcode. Fetching an import again
    needs Premium; a transcode does not. Repeating the call changes nothing.
    """
    # Without a store there is no runner either, so a queued job would never be claimed.
    require_store(request)
    settings = request.app.state.settings
    recording = await owned_recording(session, user.id, recording_id)
    with account_slot(request, user.id):
        await lock_user(session, user.id, wait_seconds=settings.request_lock_timeout_seconds)
        await reread_live(session, recording)
        if recording.state in CONFIRMED_STATES:
            # A retried call after a lost response: the first one already queued the job.
            return Response(status_code=204)
        require_state(recording, "failed")
        # Each retry that gets this far re-runs a whole transcode or import on the shared runner.
        wait = request.app.state.recording_retry_limiter.hit(user.id)
        if wait is not None:
            raise TooManyRequestsError(wait)
        if recording.split_from_id is not None and recording.original_key is None:
            await _requeue_cut(session, recording)
        elif _never_arrived(recording):
            access = await access_for(session, user.id, settings)
            if not access.premium:
                raise PremiumRequiredError
            await start_import(session, recording, access)
            if recording.error == OVER_QUOTA:
                raise QuotaExceededError
        else:
            recording.state = "uploaded"
            recording.error = None
            bump_server_seq(recording)
            await enqueue_transcode(session, recording)
        await session.flush()
    return Response(status_code=204)


async def _requeue_cut(session: AsyncSession, piece: Recording) -> None:
    """Send a failed piece that was never cut back to its parent's split job.

    A piece has no upload or import of its own: its audio is cut from the parent's full
    original, which still covers it only while the piece's split is the parent's latest
    and is not completed. A deleted parent's original belongs to the purge, which a
    piece no longer holds back once it has failed.
    """
    parent = await session.get(Recording, piece.split_from_id)
    if (
        parent is None
        or parent.deleted_at is not None
        or parent.state == "failed"
        or parent.split_id != piece.created_by_split_id
        or parent.split_completed_id == parent.split_id
    ):
        msg = "The piece's parent no longer holds the audio to cut it from"
        raise ConflictError(msg)
    piece.state = "processing"
    piece.error = None
    bump_server_seq(piece)
    await session.flush()
    await ensure_split_job(session, parent)


def _never_arrived(recording: Recording) -> bool:
    """Whether a failed import's file never arrived, so it must be fetched again.

    Read from the row, never the bucket: only a committed import sets
    `playback_bytes`, after its quota check, while an object at the upload key can be
    a write that landed after its import was abandoned. The re-import overwrites it.
    """
    return (
        recording.source == "import"
        and recording.original_key is None
        and recording.playback_bytes is None
    )


@router.get("/{recording_id}/download", responses=problem_responses(404, 409, 503))
async def download(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> DownloadUrl:
    """A presigned GET for the playback file of a ready recording.

    Carries the revision and start the signature was issued for, read from the same row
    as the key: a trim landing between this response and the client's GET changes the
    row, but never what this response already promised.
    """
    store = require_store(request)
    recording = await owned_recording(session, user.id, recording_id)
    require_state(recording, "ready")
    key = recording.playback_key
    rev = recording.playback_rev
    start_ms = recording.playback_start_ms
    if key is None or rev is None or start_ms is None:
        msg = "Recording has no playback file"
        raise ConflictError(msg)
    url, expires_at = presign_get(store, key)
    return DownloadUrl(url=url, expires_at=expires_at, playback_rev=rev, playback_start_ms=start_ms)


@router.get("/{recording_id}/peaks", responses=problem_responses(404, 409, 503))
async def peaks(
    recording_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> PeaksUrl:
    """A presigned GET for the waveform peaks file of a recording.

    Carries the revision the signature was issued for, read from the same row as the key.
    """
    store = require_store(request)
    recording = await owned_recording(session, user.id, recording_id)
    key = recording.peaks_key
    rev = recording.peaks_rev
    if key is None or rev is None:
        msg = "Recording has no peaks file"
        raise ConflictError(msg)
    url, expires_at = presign_get(store, key)
    return PeaksUrl(url=url, expires_at=expires_at, peaks_rev=rev)
