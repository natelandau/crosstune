"""The pure rule that keeps a loop inside its recording's playable range."""

from __future__ import annotations

import pytest

from crosstune.recordings.loops import clamp_loop, largest_free_stretch


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


@pytest.mark.parametrize(
    ("start", "end", "taken", "expected"),
    [
        (1000, 5000, [], (1000, 5000)),
        (1000, 9000, [(3000, 5000)], (5000, 9000)),
        (1000, 9000, [(3000, 6000)], (6000, 9000)),
        (1000, 7000, [(3000, 5000)], (1000, 3000)),
        (1000, 5000, [(0, 9000)], None),
        (1000, 5000, [(5000, 6000)], (1000, 5000)),
        (0, 20000, [(2000, 4000), (6000, 7000), (9000, 15000)], (15000, 20000)),
        (0, 20000, [(9000, 15000), (2000, 4000), (6000, 7000)], (15000, 20000)),
        (0, 12000, [(8000, 9000), (1000, 2000), (3000, 4000)], (4000, 8000)),
    ],
)
def test_largest_free_stretch(start, end, taken, expected) -> None:
    assert largest_free_stretch(start, end, taken) == expected
