"""One storage quota and one upload slot per owner, shared by recordings and notation pages."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

from crosstune.models import NotationPage, Recording, UploadSlot
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

    A live recording or page counts its open upload slot's declared size when it has
    one, otherwise its stored bytes. The slot stands in for, never adds to, the object
    already at the upload key: the PUT it signs overwrites that object, and once the
    slot expires unused the object is still there and counts again.

    Args:
        session: The session to query through.
        user_id: Whose storage to sum.
        now: The moment that decides whether a slot is still open. Defaults to the clock.
        exclude: A recording or page to leave out, for a caller sizing that file's own upload.

    Returns:
        int: The bytes that count against the user's quota.
    """
    now = now or utc_now()
    open_slots = UploadSlot.user_id == user_id, UploadSlot.expires_at > now
    total = 0
    for model, stored_column, owner_column in (
        (Recording, Recording.playback_bytes, UploadSlot.recording_id),
        (NotationPage, NotationPage.file_bytes, UploadSlot.notation_page_id),
    ):
        live = [model.user_id == user_id, model.deleted_at.is_(None)]
        if exclude is not None:
            live.append(model.id != exclude)
        has_open_slot = select(owner_column).where(*open_slots, owner_column.is_not(None))
        stored = await session.scalar(
            select(func.coalesce(func.sum(stored_column), 0)).where(
                *live, model.id.not_in(has_open_slot)
            )
        )
        reserved = await session.scalar(
            select(func.coalesce(func.sum(UploadSlot.declared_bytes), 0))
            .join(model, model.id == owner_column)
            .where(*live, *open_slots)
        )
        total += int(stored or 0) + int(reserved or 0)
    return total


async def slot_for_recording(session: AsyncSession, recording_id: uuid.UUID) -> UploadSlot | None:
    """The upload slot a recording holds, or None."""
    return await session.scalar(select(UploadSlot).where(UploadSlot.recording_id == recording_id))


async def slot_for_page(session: AsyncSession, page_id: uuid.UUID) -> UploadSlot | None:
    """The upload slot a notation page holds, or None."""
    return await session.scalar(select(UploadSlot).where(UploadSlot.notation_page_id == page_id))
