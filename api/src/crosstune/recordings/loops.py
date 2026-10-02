"""Rules that keep a practice loop inside its recording's trimmed range."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select, update

from crosstune.db.base import next_server_seq
from crosstune.models import RecordingLoop
from crosstune.recordings.trim import effective_end
from crosstune.vocabulary import MIN_LOOP_MS

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording


def clamp_span(start_ms: int, end_ms: int, *, low: int, high: int | None) -> tuple[int, int]:
    """Clamp both ends into `[low, high]`, leaving the span as short as it falls.

    Args:
        start_ms: The loop start.
        end_ms: The loop end.
        low: The lowest either end may fall.
        high: The highest either end may reach, or None if the range has no known end.

    Returns:
        tuple[int, int]: The clamped start and end.
    """
    start = max(start_ms, low)
    end = max(end_ms, low)
    if high is not None:
        start = min(start, high)
        end = min(end, high)
    return start, end


def clamp_loop(start_ms: int, end_ms: int, *, low: int, high: int | None) -> tuple[int, int] | None:
    """Clamp a loop into `[low, high]`, or None when under `MIN_LOOP_MS` remains.

    Args:
        start_ms: The loop start.
        end_ms: The loop end.
        low: The lowest the start may fall.
        high: The highest the end may reach, or None if the range has no known end.

    Returns:
        tuple[int, int] | None: The clamped start and end, or None if the loop no longer fits.
    """
    start, end = clamp_span(start_ms, end_ms, low=low, high=high)
    return (start, end) if end - start >= MIN_LOOP_MS else None


def loop_bounds(recording: Recording) -> tuple[int, int | None]:
    """The source-timeline range a recording's loops must stay inside.

    Args:
        recording: The loops' parent recording.

    Returns:
        tuple[int, int | None]: The trim start and the trim end, falling back to the
            source duration, which is None while the server doesn't know the length.
    """
    return recording.trim_start_ms, effective_end(recording)


async def reclamp_recording_loops(
    session: AsyncSession, recording: Recording, at: datetime
) -> None:
    """Pull a recording's live loops back inside its trim, deleting any that no longer fit.

    Args:
        session: The open session.
        recording: The recording whose trim was just written.
        at: The time to stamp on every loop that changes, or just past the loop's own
            stamp when that is not earlier, so a reclamp never ages a loop and lets an
            older edit win last-write-wins over a newer one.
    """
    low, high = loop_bounds(recording)
    loops = await session.scalars(
        select(RecordingLoop).where(
            RecordingLoop.recording_id == recording.id,
            RecordingLoop.user_id == recording.user_id,
            RecordingLoop.deleted_at.is_(None),
        )
    )
    for row in loops:
        clamped = clamp_loop(row.start_ms, row.end_ms, low=low, high=high)
        start, end = clamped or clamp_span(row.start_ms, row.end_ms, low=low, high=high)
        if clamped and (start, end) == (row.start_ms, row.end_ms):
            continue
        stamp = max(at, row.updated_at + timedelta(milliseconds=1))
        await session.execute(
            update(RecordingLoop)
            .where(RecordingLoop.id == row.id)
            .values(
                start_ms=start,
                end_ms=end,
                deleted_at=None if clamped else stamp,
                updated_at=stamp,
                server_seq=next_server_seq(),
            )
            .execution_options(synchronize_session=False)
        )
