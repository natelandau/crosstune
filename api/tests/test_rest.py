"""What the shared REST helpers read from another service's answers."""

from __future__ import annotations

import pytest

from crosstune.rest import DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, wait_seconds


@pytest.mark.parametrize(
    ("header", "expected"),
    [
        ("12", 12.0),
        (" 7 ", 7.0),
        ("0", 1.0),
        ("100000", MAX_WAIT_SECONDS),
        (None, DEFAULT_WAIT_SECONDS),
        ("", DEFAULT_WAIT_SECONDS),
        ("Wed, 21 Oct 2026 07:28:00 GMT", DEFAULT_WAIT_SECONDS),
        ("-3", DEFAULT_WAIT_SECONDS),
        ("²", DEFAULT_WAIT_SECONDS),
    ],
)
def test_wait_seconds_reads_retry_after_within_bounds(header: str | None, expected: float) -> None:
    assert wait_seconds(header) == expected
