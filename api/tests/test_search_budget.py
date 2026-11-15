"""Each music service gets a burst of requests, then a steady rate, shared by every user."""

from __future__ import annotations

import pytest

from crosstune.links.search.budget import TokenBucket, search_cost
from crosstune.vocabulary import Provider
from tests.helpers import Clock


def test_a_burst_up_to_the_bucket_size_is_allowed_then_refused() -> None:
    bucket = TokenBucket(burst=4, per_second=1.5, clock=Clock())

    assert [bucket.take() for _ in range(5)] == [True, True, True, True, False]


def test_tokens_refill_at_the_rate_up_to_the_burst() -> None:
    clock = Clock()
    bucket = TokenBucket(burst=4, per_second=2.0, clock=clock)
    for _ in range(4):
        bucket.take()

    clock.now += 0.4
    assert not bucket.take()
    clock.now += 0.1
    assert bucket.take()
    assert not bucket.take()
    # A long idle spell refills to the burst and no further.
    clock.now += 60
    assert [bucket.take() for _ in range(5)] == [True, True, True, True, False]


INLINE = {Provider.APPLE_MUSIC, Provider.TIDAL, Provider.INTERNET_ARCHIVE}


@pytest.mark.parametrize(
    ("providers", "inline", "cost"),
    [
        ([Provider.APPLE_MUSIC], INLINE, 1),
        ([Provider.TIDAL], INLINE, 2),
        ([Provider.TIDAL, Provider.TIDAL], INLINE, 2),
        ([Provider.APPLE_MUSIC, Provider.TIDAL, Provider.INTERNET_ARCHIVE], INLINE, 4),
        ([Provider.SPOTIFY, Provider.YOUTUBE], INLINE, 1),
        # A service with no credentials is never called, so it costs nothing.
        ([Provider.TIDAL, Provider.INTERNET_ARCHIVE], {Provider.INTERNET_ARCHIVE}, 1),
    ],
)
def test_a_search_costs_the_outbound_requests_it_expects(
    providers: list[Provider], inline: set[Provider], cost: int
) -> None:
    assert search_cost(providers, inline) == cost
