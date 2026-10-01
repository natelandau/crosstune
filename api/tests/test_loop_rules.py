"""The pure rule that keeps a loop inside its recording's playable range."""

from __future__ import annotations

import pytest

from crosstune.recordings.loops import clamp_loop


@pytest.mark.parametrize(
    ("start", "end", "high", "expected"),
    [
        (0, 5000, 61000, (1000, 5000)),
        (60800, 70000, 61000, None),
        (60000, 70000, 61000, (60000, 61000)),
        (0, 70000, None, (1000, 70000)),
        (0, 1200, None, None),
    ],
)
def test_clamp_loop(start, end, high, expected) -> None:
    assert clamp_loop(start, end, low=1000, high=high) == expected
