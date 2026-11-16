"""A rate-limited music service is left alone until its wait is over."""

from __future__ import annotations

from crosstune.links.search.backoff import Backoff
from crosstune.vocabulary import Provider


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
