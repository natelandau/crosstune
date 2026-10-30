"""Rules for the pieces a split makes out of one parent recording."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import and_, exists, func, select
from sqlalchemy.orm import aliased

from crosstune.db.base import bump_server_seq
from crosstune.models import Recording

if TYPE_CHECKING:
    import uuid

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession


def latest_split_pieces(
    parent_id: Any, split_id: Any, *, piece: Any = Recording
) -> ColumnElement[bool]:
    """A filter on `piece` matching the pieces one split of the parent created.

    Live and soft-deleted pieces alike. The arguments may be values or columns of an
    outer query.

    Args:
        parent_id: The recording the pieces were split from.
        split_id: The split that created them, usually the parent's `split_id`.
        piece: The entity the filter reads, `Recording` or an alias of it.
    """
    return and_(piece.split_from_id == parent_id, piece.created_by_split_id == split_id)


def waiting_pieces(parent_id: Any, *, piece: Any = Recording) -> ColumnElement[bool]:
    """A filter on `piece` matching live pieces of any split of the parent still waiting for their cut.

    Args:
        parent_id: The recording the pieces were split from, a value or an outer column.
        piece: The entity the filter reads, `Recording` or an alias of it.
    """
    return and_(
        piece.split_from_id == parent_id,
        piece.deleted_at.is_(None),
        piece.state == "processing",
    )


async def split_pieces_start(session: AsyncSession, parent: Recording) -> int | None:
    """Where the audio of the parent's latest split's pieces starts on the source timeline.

    A cut piece's slice can start before its trim, so the earlier of the two counts.
    Deleted pieces count too, so their audio is never assumed to belong to no one.

    Args:
        session: The session to query through.
        parent: The recording the pieces were split from.

    Returns:
        int | None: The earliest start, or None when the server holds no piece of the split.
    """
    rows = (
        await session.execute(
            select(
                Recording.trim_start_ms, Recording.source_offset_ms, Recording.original_key
            ).where(latest_split_pieces(parent.id, parent.split_id))
        )
    ).all()
    starts = [
        min(row.trim_start_ms, row.source_offset_ms)
        if row.original_key is not None
        else row.trim_start_ms
        for row in rows
    ]
    return min(starts, default=None)


async def split_first_cut(session: AsyncSession, parent: Recording) -> int | None:
    """Where the earliest piece of the parent's latest split begins.

    The highest end the parent's trim may reach while it carries that split.

    Deleted pieces count too, so a parent never widens over audio a piece was cut from.

    Args:
        session: The session to query through.
        parent: The recording the pieces were split from.

    Returns:
        int | None: The earliest piece trim start, or None when the server holds no piece.
    """
    if parent.split_id is None:
        return None
    return await session.scalar(
        select(func.min(Recording.trim_start_ms)).where(
            latest_split_pieces(parent.id, parent.split_id)
        )
    )


def holds_original() -> ColumnElement[bool]:
    """A filter on `Recording` matching a parent whose original a waiting piece still needs.

    A live piece split from the parent, of any of its splits, that is still processing
    is cut from the parent's original. A failed parent holds nothing: its pieces fail with
    it. Every client applies the same rule to Delete, so purge and Delete agree.
    """
    piece = aliased(Recording)
    return and_(
        Recording.state != "failed",
        exists().where(waiting_pieces(Recording.id, piece=piece)),
    )


async def split_holds_original(session: AsyncSession, parent: Recording) -> bool:
    """Whether a live piece split from the parent still waits for its cut from the original.

    Args:
        session: The session to query through.
        parent: The recording the pieces were split from.

    Returns:
        bool: True while the parent has not failed and a live piece of it is processing.
    """
    if parent.state == "failed":
        return False
    held = await session.scalar(
        select(Recording.id).where(Recording.id == parent.id, holds_original()).limit(1)
    )
    return held is not None


def ready_to_complete() -> ColumnElement[bool]:
    """A filter on `Recording` matching a parent whose latest split may now be completed.

    The split is not yet recorded as completed, every piece row of it is on the server,
    deleted ones included, and every live one names its own original and is no longer
    processing. A failed piece has no original, so it keeps the split open until it is
    deleted.
    """
    piece = aliased(Recording)
    pieces = latest_split_pieces(Recording.id, Recording.split_id, piece=piece)
    held = (
        select(func.count()).select_from(piece).where(pieces).correlate(Recording)
    ).scalar_subquery()
    return and_(
        Recording.split_id.is_not(None),
        Recording.split_size.is_not(None),
        Recording.split_completed_id.is_distinct_from(Recording.split_id),
        held >= Recording.split_size - 1,
        ~exists().where(
            pieces,
            piece.deleted_at.is_(None),
            (piece.original_key.is_(None)) | (piece.state == "processing"),
        ),
    )


async def split_ready_to_complete(session: AsyncSession, parent: Recording) -> bool:
    """Whether the parent's latest split is uncompleted and every piece of it has its slice.

    Read straight from the database, never from rows the session already holds.

    Args:
        session: The session to query through.
        parent: The recording the pieces were split from.

    Returns:
        bool: True when the split job may record the split as completed.
    """
    ready = await session.scalar(
        select(Recording.id).where(Recording.id == parent.id, ready_to_complete()).limit(1)
    )
    return ready is not None


async def fail_waiting_pieces(session: AsyncSession, parent_id: uuid.UUID, error: str) -> int:
    """Fail every live piece split from the parent that is still waiting for its cut.

    Pieces of an earlier split of the parent count too, so none is left processing.
    The parent is untouched: it keeps its full original, so a failure loses no audio.
    Called under the user's lock, in the caller's transaction.

    Args:
        session: The session to write through.
        parent_id: The recording the pieces were split from.
        error: The phrase a client shows on each failed piece.

    Returns:
        int: How many pieces were failed.
    """
    failed = 0
    for piece in await session.scalars(select(Recording).where(waiting_pieces(parent_id))):
        piece.state = "failed"
        piece.error = error
        bump_server_seq(piece)
        failed += 1
    return failed


async def fail_parent_split(session: AsyncSession, parent: Recording) -> None:
    """Fail the waiting pieces of a parent that just failed, and complete its split.

    A failed parent has nothing to cut from, so its split can never finish otherwise.
    Called under the user's lock, in the caller's transaction, after the parent's own
    failure is set.

    Args:
        session: The session to write through.
        parent: The failed recording the pieces were split from.
    """
    await fail_waiting_pieces(session, parent.id, parent.error or "")
    if parent.split_id is not None and parent.split_completed_id != parent.split_id:
        parent.split_completed_id = parent.split_id
        bump_server_seq(parent)
