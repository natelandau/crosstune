"""One storage quota and one upload slot per owner, shared by recordings and scans."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import func, select

from crosstune.db.base import utc_now
from crosstune.errors import ConflictError, QuotaExceededError
from crosstune.files.urls import UPLOAD_SIZE_TOLERANCE, UPLOAD_URL_TTL_SECONDS, file_too_large
from crosstune.models import Recording, Scan, UploadSlot

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession
    from sqlalchemy.orm import InstrumentedAttribute

    from crosstune.storage.store import ObjectInfo, ObjectStore

type SlotOwner = Recording | Scan


async def used_bytes(
    session: AsyncSession,
    user_id: uuid.UUID,
    now: datetime | None = None,
    *,
    exclude: uuid.UUID | None = None,
    include_recordings: bool = True,
) -> int:
    """The bytes that count against a user's quota.

    A live recording or scan counts its open upload slot's declared size when it has
    one, otherwise its stored bytes. The slot stands in for, never adds to, the object
    already at the upload key: the PUT it signs overwrites that object, and once the
    slot expires unused the object is still there and counts again.

    Args:
        session: The session to query through.
        user_id: Whose storage to sum.
        now: The moment that decides whether a slot is still open. Defaults to the clock.
        exclude: A recording or scan to leave out, for a caller sizing that file's own upload.
        include_recordings: Whether recordings count. A free plan's quota covers scans only.

    Returns:
        int: The bytes that count against the user's quota.
    """
    now = now or utc_now()
    counted = [(Scan, Scan.file_bytes, UploadSlot.scan_id)]
    if include_recordings:
        counted.append((Recording, Recording.playback_bytes, UploadSlot.recording_id))
    usage = [
        _usage(model, stored_column, owner_column, user_id=user_id, now=now, exclude=exclude)
        for model, stored_column, owner_column in counted
    ]
    # One statement, since callers hold the user's lock while it runs.
    total = await session.scalar(select(sum(usage[1:], start=usage[0])))
    return int(total or 0)


def _usage(
    model: type[Recording | Scan],
    stored_column: InstrumentedAttribute[int | None],
    owner_column: InstrumentedAttribute[uuid.UUID | None],
    *,
    user_id: uuid.UUID,
    now: datetime,
    exclude: uuid.UUID | None,
) -> ColumnElement[int]:
    """One file type's share of `used_bytes`, as a SQL expression."""
    open_slots = UploadSlot.user_id == user_id, UploadSlot.expires_at > now
    live = [model.user_id == user_id, model.deleted_at.is_(None)]
    if exclude is not None:
        live.append(model.id != exclude)
    has_open_slot = select(owner_column).where(*open_slots, owner_column.is_not(None))
    stored = (
        select(func.coalesce(func.sum(stored_column), 0))
        .where(*live, model.id.not_in(has_open_slot))
        .scalar_subquery()
    )
    reserved = (
        select(func.coalesce(func.sum(UploadSlot.declared_bytes), 0))
        .join(model, model.id == owner_column)
        .where(*live, *open_slots)
        .scalar_subquery()
    )
    return stored + reserved


async def slot_for_recording(session: AsyncSession, recording_id: uuid.UUID) -> UploadSlot | None:
    """The upload slot a recording holds, or None."""
    return await session.scalar(select(UploadSlot).where(UploadSlot.recording_id == recording_id))


async def slot_for_scan(session: AsyncSession, scan_id: uuid.UUID) -> UploadSlot | None:
    """The upload slot a scan holds, or None."""
    return await session.scalar(select(UploadSlot).where(UploadSlot.scan_id == scan_id))


async def _slot_for(session: AsyncSession, owner: SlotOwner) -> UploadSlot | None:
    if isinstance(owner, Recording):
        return await slot_for_recording(session, owner.id)
    return await slot_for_scan(session, owner.id)


async def reserve_slot(
    session: AsyncSession,
    owner: SlotOwner,
    *,
    declared_bytes: int,
    content_type: str,
    max_file_bytes: int,
    quota_bytes: int,
    include_recordings: bool = True,
) -> datetime:
    """Open or renew the owner's upload slot once the file cap and the quota allow it.

    Every route that signs a PUT goes through here, so one file type can never get a
    looser quota check than another. The caller holds the user's lock and has checked
    the owner's state.

    Args:
        session: The session to write through.
        owner: The recording or scan the upload is for.
        declared_bytes: The size the client says it will upload.
        content_type: The content type the signed PUT will carry.
        max_file_bytes: The per-file cap for this kind of file.
        quota_bytes: The user's storage quota.
        include_recordings: Whether recordings count toward `quota_bytes`.

    Returns:
        datetime: When the slot, and the URL signed for it, expires.
    """
    if declared_bytes > max_file_bytes:
        raise file_too_large(max_file_bytes)
    now = utc_now()
    existing = await _slot_for(session, owner)
    # The owner's own slot or stored file is what the new PUT replaces.
    used = await used_bytes(
        session, owner.user_id, now, exclude=owner.id, include_recordings=include_recordings
    )
    if used + declared_bytes > quota_bytes:
        msg = f"{used} of {quota_bytes} bytes used"
        raise QuotaExceededError(msg)

    expires_at = now + timedelta(seconds=UPLOAD_URL_TTL_SECONDS)
    if existing is None:
        owner_id = (
            {"recording_id": owner.id} if isinstance(owner, Recording) else {"scan_id": owner.id}
        )
        session.add(
            UploadSlot(
                **owner_id,
                user_id=owner.user_id,
                declared_bytes=declared_bytes,
                content_type=content_type,
                expires_at=expires_at,
            )
        )
    else:
        existing.declared_bytes = declared_bytes
        existing.content_type = content_type
        existing.expires_at = expires_at
    return expires_at


async def verify_upload(
    store: ObjectStore,
    key: str,
    info: ObjectInfo | None,
    slot: UploadSlot | None,
    *,
    max_file_bytes: int,
) -> int:
    """Check a landed object against its open slot before the caller confirms it.

    An object over the file cap or its declared size is deleted, so a rejected upload
    never lingers uncounted in the bucket.

    Args:
        store: The bucket the object landed in.
        key: The object's key.
        info: The object's size and type, read from the bucket, or None when nothing landed.
        slot: The owner's upload slot, or None.
        max_file_bytes: The per-file cap for this kind of file.

    Returns:
        int: The size of the accepted object.
    """
    if slot is None or slot.expires_at <= utc_now():
        msg = "No open upload slot; request a new one"
        raise ConflictError(msg)
    if info is None:
        msg = "No file was uploaded"
        raise ConflictError(msg)
    if info.size > max_file_bytes:
        await store.delete(key)
        raise file_too_large(max_file_bytes)
    if info.size > slot.declared_bytes * (1 + UPLOAD_SIZE_TOLERANCE):
        await store.delete(key)
        msg = f"Uploaded {info.size} bytes but declared {slot.declared_bytes}"
        raise QuotaExceededError(msg)
    return info.size
