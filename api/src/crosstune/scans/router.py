"""Presigned uploads and downloads for scan images."""

from __future__ import annotations

import logging
import uuid  # noqa: TC003 -- FastAPI resolves path parameter annotations at runtime
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.billing.access import access_for
from crosstune.db.base import bump_server_seq
from crosstune.db.locks import lock_user
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import ConflictError, PremiumRequiredError, problem_responses
from crosstune.files.quota import accept_upload, head_slot, reserve_slot, slot_for_scan
from crosstune.files.urls import UPLOAD_URL_TTL_SECONDS, SignedUrl, presign_get, require_store
from crosstune.scans.service import owned_scan, require_live, require_state
from crosstune.storage.store import delete_best_effort, legacy_scan_key, scan_key
from crosstune.vocabulary import ScanState

log = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/scans", tags=["scans"])


class ScanUploadSlotRequest(BaseModel):
    """What the client is about to upload."""

    bytes: int = Field(gt=0)
    content_type: Literal["image/jpeg"]


@router.post("/{scan_id}/upload-slot", responses=problem_responses(403, 404, 409, 413, 503))
async def upload_slot(
    scan_id: uuid.UUID,
    body: ScanUploadSlotRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SignedUrl:
    """A presigned PUT for one scan's image, once the file cap, the plan, and its quota allow it."""
    store = require_store(request)
    settings = request.app.state.settings
    await lock_user(session, user.id, wait_seconds=settings.request_lock_timeout_seconds)
    scan = await owned_scan(session, user.id, scan_id)
    require_state(scan, ScanState.PENDING_UPLOAD)
    access = await access_for(session, user.id, settings)
    if not access.premium:
        raise PremiumRequiredError
    slot = await reserve_slot(
        session,
        scan,
        declared_bytes=body.bytes,
        content_type=body.content_type,
        max_file_bytes=settings.scan_max_file_bytes,
        quota_bytes=access.quota_bytes,
    )
    await session.flush()
    url = store.presign_put(slot.object_key, body.content_type, body.bytes, UPLOAD_URL_TTL_SECONDS)
    return SignedUrl(url=url, expires_at=slot.expires_at)


@router.post(
    "/{scan_id}/uploaded", status_code=204, responses=problem_responses(404, 409, 413, 503)
)
async def upload_finished(
    scan_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
    background: BackgroundTasks,
) -> Response:
    """Confirm the image landed and mark the scan ready. Repeating the call changes nothing."""
    store = require_store(request)
    settings = request.app.state.settings
    key = scan_key(user.id, scan_id)
    scan = await owned_scan(session, user.id, scan_id)
    # The bucket round trip happens before the lock so it never holds up the caller's other writes.
    info = await head_slot(store, await slot_for_scan(session, scan.id))
    await lock_user(session, user.id, wait_seconds=settings.request_lock_timeout_seconds)
    # Re-read under the lock: another request may have confirmed or deleted this scan,
    # or deleted its tune, meanwhile.
    await session.refresh(scan)
    await require_live(session, scan)
    slot = await slot_for_scan(session, scan.id)
    if scan.state == ScanState.READY and slot is None:
        # A retried call after a lost response: the first one consumed the slot.
        return Response(status_code=204)
    require_state(scan, ScanState.PENDING_UPLOAD)
    size = await accept_upload(
        session, store, slot, info, target=key, max_file_bytes=settings.scan_max_file_bytes
    )
    # A slot whose key is the served key holds the confirmed image, so only a staged key is deleted.
    staged = slot.object_key if slot is not None and slot.object_key != key else None

    scan.state = ScanState.READY.value
    scan.file_key = key
    scan.file_bytes = size
    bump_server_seq(scan)
    await session.delete(slot)
    await session.flush()
    # No row names an object a legacy-key PUT left, so no sweep removes it; delete it here.
    # After the commit, so the bucket call never holds the user's lock; a staged image
    # left over is a stray the sweep removes.
    background.add_task(
        delete_best_effort,
        store,
        [legacy_scan_key(user.id, scan.id), staged],
        log=log,
        message="could not delete a legacy or staged scan object",
    )
    return Response(status_code=204)


@router.get("/{scan_id}/download", responses=problem_responses(404, 409, 503))
async def download(
    scan_id: uuid.UUID,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> SignedUrl:
    """A presigned GET for the image of a ready scan."""
    store = require_store(request)
    scan = await owned_scan(session, user.id, scan_id)
    require_state(scan, ScanState.READY)
    if scan.file_key is None:
        msg = "Scan has no image"
        raise ConflictError(msg)
    url, expires_at = presign_get(store, scan.file_key)
    return SignedUrl(url=url, expires_at=expires_at)
