"""Pure rules for keeping a recording's trim inside its playback range."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.vocabulary import MIN_TRIM_MS

if TYPE_CHECKING:
    from crosstune.models import Recording


def clamp_stored_trim(recording: Recording, *, high: int | None) -> None:
    """Narrow the row's saved trim into `[0, high]`, writing the columns only if that moves them."""
    start_ms, end_ms = clamp_trim(recording.trim_start_ms, recording.trim_end_ms, low=0, high=high)
    if (start_ms, end_ms) != (recording.trim_start_ms, recording.trim_end_ms):
        recording.trim_start_ms = start_ms
        recording.trim_end_ms = end_ms


def clamp_trim(
    start_ms: int, end_ms: int | None, *, low: int, high: int | None
) -> tuple[int, int | None]:
    """Clamp a requested trim into `[low, high]` and at least `MIN_TRIM_MS` long.

    Moves the end first and then the start to reach the minimum length, so a start
    at `low` grows the end instead of pulling `low` negative. `high` is None before
    the server knows the source length, in which case only the lower bound and the
    minimum length are enforced. A `None` end_ms means the source end and stays
    None unless the start has to move to keep the range long enough.

    Args:
        start_ms: The requested trim start.
        end_ms: The requested trim end, or None for the source end.
        low: The lowest a start may fall.
        high: The highest an end may reach, or None if the source length is unknown.

    Returns:
        tuple[int, int | None]: The clamped start and end.
    """
    if high is None:
        start = max(start_ms, low)
        end = None if end_ms is None else max(end_ms, start + MIN_TRIM_MS)
        return start, end

    if high - low < MIN_TRIM_MS:
        return low, high

    start = min(max(start_ms, low), high)

    if end_ms is None:
        if high - start < MIN_TRIM_MS:
            start = max(low, high - MIN_TRIM_MS)
        return start, None

    end = min(max(end_ms, low), high)
    if end - start < MIN_TRIM_MS:
        if start + MIN_TRIM_MS <= high:
            end = start + MIN_TRIM_MS
        else:
            end = high
            start = high - MIN_TRIM_MS
    return start, end


def effective_end(recording: Recording) -> int | None:
    """The trim end a playback file should match, filling in the source end.

    Args:
        recording: The recording to read.

    Returns:
        int | None: `trim_end_ms`, or `source_duration_ms` when no trim end is set.
    """
    return (
        recording.trim_end_ms if recording.trim_end_ms is not None else recording.source_duration_ms
    )


def needs_trim(recording: Recording) -> bool:
    """Whether a trim job must run before the playback file matches the recording's trim.

    Args:
        recording: The recording to check.

    Returns:
        bool: True if the job runner should queue a trim job.
    """
    if recording.state != "ready":
        return False
    if recording.playback_start_ms is None or recording.playback_end_ms is None:
        # With no known range there is nothing a cut could be measured against.
        return False
    return (
        recording.trim_start_ms != recording.playback_start_ms
        or effective_end(recording) != recording.playback_end_ms
    )
