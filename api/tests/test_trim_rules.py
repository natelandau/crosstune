"""Pure trim rules: clamping a requested trim and deciding whether a job must rebuild it."""

from __future__ import annotations

import uuid

import pytest

from crosstune.models import Recording
from crosstune.models.user import utc_now
from crosstune.recordings.trim import clamp_trim, needs_trim


def make_recording(**overrides: object) -> Recording:
    """An unsaved Recording carrying only the columns the trim rules read.

    Args:
        overrides: Column values to set beyond the defaults below.

    Returns:
        Recording: An in-memory recording, never added to a session.
    """
    defaults = {
        "id": uuid.uuid4(),
        "user_id": uuid.uuid4(),
        "source": "upload",
        "recorded_at": utc_now(),
        "created_at": utc_now(),
        "updated_at": utc_now(),
        "state": "ready",
        "trim_start_ms": 0,
        "trim_end_ms": None,
        "source_duration_ms": 10_000,
        "playback_start_ms": 0,
        "playback_end_ms": 10_000,
    }
    defaults.update(overrides)
    return Recording(**defaults)


@pytest.mark.parametrize(
    ("start_ms", "end_ms", "low", "high", "expected"),
    [
        # Inside range, unchanged.
        (1_000, 5_000, 0, 10_000, (1_000, 5_000)),
        # Start below low, raised.
        (-500, 5_000, 0, 10_000, (0, 5_000)),
        # End above high, lowered.
        (1_000, 12_000, 0, 10_000, (1_000, 10_000)),
        # end_ms=None with high=None, unchanged.
        (1_000, None, 0, None, (1_000, None)),
        # high=None: start raised to low, end raised to meet the minimum length.
        (-500, 100, 0, None, (0, 1_000)),
        # 400 ms range widened to 1000 ms by moving the end.
        (1_000, 1_400, 0, 10_000, (1_000, 2_000)),
        # 400 ms range at high widened by moving the start, since the end can't move past high.
        (9_600, 10_000, 0, 10_000, (9_000, 10_000)),
        # end_ms=None with high known: start moved down so the range meets the minimum length.
        (9_600, None, 0, 10_000, (9_000, None)),
        # end_ms=None with high known: start already leaves enough room, so it stays.
        (1_000, None, 0, 10_000, (1_000, None)),
        # high - low < MIN_TRIM_MS: returns (low, high) regardless of the request.
        (100, 200, 0, 400, (0, 400)),
    ],
)
def test_clamp_trim(
    start_ms: int, end_ms: int | None, low: int, high: int | None, expected: tuple[int, int | None]
) -> None:
    assert clamp_trim(start_ms, end_ms, low=low, high=high) == expected


def test_needs_trim_is_false_for_an_untrimmed_ready_recording() -> None:
    rec = make_recording(
        trim_start_ms=0, trim_end_ms=None, playback_start_ms=0, playback_end_ms=10_000
    )
    assert needs_trim(rec) is False


def test_needs_trim_is_true_when_only_the_start_changed() -> None:
    rec = make_recording(
        trim_start_ms=1_000, trim_end_ms=None, playback_start_ms=0, playback_end_ms=10_000
    )
    assert needs_trim(rec) is True


def test_needs_trim_is_false_when_trim_end_matches_playback_end() -> None:
    rec = make_recording(
        trim_start_ms=0, trim_end_ms=10_000, playback_start_ms=0, playback_end_ms=10_000
    )
    assert needs_trim(rec) is False


def test_needs_trim_is_false_while_processing() -> None:
    rec = make_recording(
        state="processing",
        trim_start_ms=1_000,
        trim_end_ms=None,
        playback_start_ms=0,
        playback_end_ms=10_000,
    )
    assert needs_trim(rec) is False


@pytest.mark.parametrize(
    ("playback_start_ms", "playback_end_ms", "source_duration_ms"),
    [(None, None, None), (0, None, None), (None, 10_000, 10_000)],
)
def test_needs_trim_is_false_without_a_playback_range(
    playback_start_ms: int | None, playback_end_ms: int | None, source_duration_ms: int | None
) -> None:
    """A ready row with no known range has nothing a cut could be measured against."""
    rec = make_recording(
        trim_start_ms=1_000,
        trim_end_ms=5_000,
        playback_start_ms=playback_start_ms,
        playback_end_ms=playback_end_ms,
        source_duration_ms=source_duration_ms,
    )
    assert needs_trim(rec) is False
