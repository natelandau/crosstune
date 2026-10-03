"""A rate-limited music service is left alone until its wait is over."""

from __future__ import annotations

import pytest

from crosstune.links.search.backoff import (
    DEFAULT_WAIT_SECONDS,
    MAX_WAIT_SECONDS,
    Backoff,
    wait_seconds,
)
from crosstune.vocabulary import Provider


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


def test_a_held_service_is_released_when_its_wait_ends() -> None:
    now = [0.0]
    backoff = Backoff(clock=lambda: now[0])
    backoff.hold(Provider.TIDAL, 30)

    assert backoff.held(Provider.TIDAL)
    assert not backoff.held(Provider.APPLE_MUSIC)
    now[0] = 29.9
    assert backoff.held(Provider.TIDAL)
    now[0] = 30
    assert not backoff.held(Provider.TIDAL)


def test_a_shorter_hold_never_cuts_a_longer_one() -> None:
    now = [0.0]
    backoff = Backoff(clock=lambda: now[0])
    backoff.hold(Provider.TIDAL, 60)
    backoff.hold(Provider.TIDAL, 5)

    now[0] = 30
    assert backoff.held(Provider.TIDAL)
