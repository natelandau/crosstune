"""Presigned uploads and downloads for notation page images."""

from __future__ import annotations

import uuid  # noqa: TC003 -- FastAPI resolves path parameter annotations at runtime
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Request, Response
from pydantic import BaseModel, Field

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.locks import lock_user
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import ConflictError, QuotaExceededError, problem_responses
from crosstune.files.quota import slot_for_page, used_bytes
from crosstune.files.urls import (
    UPLOAD_SIZE_TOLERANCE,
    UPLOAD_URL_TTL_SECONDS,
    SignedUrl,
    file_too_large,
    presign_get,
    require_store,
)
from crosstune.models import UploadSlot
from crosstune.models.user import utc_now
from crosstune.notation.service import (
    bump_page_server_seq,
    owned_page,
    require_live,
    require_state,
)
from crosstune.storage.store import notation_key
from crosstune.vocabulary import NotationPageState

router = APIRouter(prefix="/v1/notation-pages", tags=["notation"])


class NotationUploadSlotRequest(BaseModel):
    """What the client is about to upload."""

    bytes: int = Field(gt=0)
    content_type: Literal["image/jpeg"]


@router.post("/{page_id}/upload-slot", responses=problem_responses(404, 409, 413, 503))
async def upload_slot(
    page_id: uuid.UUID,
    body: NotationUploadSlotRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SignedUrl:
    """A presigned PUT for one page's image, once the file cap and quota allow it."""
    store = require_store(request)
    settings = request.app.state.settings
    await lock_user(session, user.id)
    page = await owned_page(session, user.id, page_id)
    require_state(page, NotationPageState.PENDING_UPLOAD)
    if body.bytes > settings.notation_max_file_bytes:
        raise file_too_large(settings.notation_max_file_bytes)

    now = utc_now()
    existing = await slot_for_page(session, page.id)
    # This page's own open slot is what the new PUT replaces.
    used = await used_bytes(session, user.id, now, exclude=page.id)
    if used + body.bytes > settings.storage_quota_bytes:
        msg = f"{used} of {settings.storage_quota_bytes} bytes used"
        raise QuotaExceededError(msg)

    expires_at = now + timedelta(seconds=UPLOAD_URL_TTL_SECONDS)
    if existing is None:
        session.add(
            UploadSlot(
                notation_page_id=page.id,
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
    await session.flush()
    url = store.presign_put(
        notation_key(user.id, page.id), body.content_type, body.bytes, UPLOAD_URL_TTL_SECONDS
    )
    return SignedUrl(url=url, expires_at=expires_at)


@router.post(
    "/{page_id}/uploaded", status_code=204, responses=problem_responses(404, 409, 413, 503)
)
async def upload_finished(
    page_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> Response:
    """Confirm the image landed and mark the page ready. Repeating the call changes nothing."""
    store = require_store(request)
    settings = request.app.state.settings
    key = notation_key(user.id, page_id)
    page = await owned_page(session, user.id, page_id)
    # The bucket round trip happens before the lock so it never holds up the caller's other writes.
    info = await store.head(key)
    await lock_user(session, user.id)
    # Re-read under the lock: another request may have confirmed or deleted this page,
    # or deleted its tune, meanwhile.
    await session.refresh(page)
    await require_live(session, page)
    slot = await slot_for_page(session, page.id)
    if page.state == NotationPageState.READY and slot is None:
        # A retried call after a lost response: the first one consumed the slot.
        return Response(status_code=204)
    require_state(page, NotationPageState.PENDING_UPLOAD)
    if slot is None or slot.expires_at <= utc_now():
        msg = "No open upload slot; request a new one"
        raise ConflictError(msg)
    if info is None:
        msg = "No file was uploaded"
        raise ConflictError(msg)
    if info.size > settings.notation_max_file_bytes:
        await store.delete(key)
        raise file_too_large(settings.notation_max_file_bytes)
    if info.size > slot.declared_bytes * (1 + UPLOAD_SIZE_TOLERANCE):
        await store.delete(key)
        msg = f"Uploaded {info.size} bytes but declared {slot.declared_bytes}"
        raise QuotaExceededError(msg)

    page.state = NotationPageState.READY.value
    page.file_key = key
    page.file_bytes = info.size
    bump_page_server_seq(page)
    await session.delete(slot)
    await session.flush()
    return Response(status_code=204)


@router.get("/{page_id}/download", responses=problem_responses(404, 409, 503))
async def download(
    page_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SignedUrl:
    """A presigned GET for the image of a ready page."""
    store = require_store(request)
    page = await owned_page(session, user.id, page_id)
    require_state(page, NotationPageState.READY)
    if page.file_key is None:
        msg = "Page has no image"
        raise ConflictError(msg)
    url, expires_at = presign_get(store, page.file_key)
    return SignedUrl(url=url, expires_at=expires_at)
