"""A caller gets a fixed number of hits per sliding window, then a wait."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.ratelimit import RateLimiter
from tests.test_resolve import OEMBED


class Clock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def test_allows_the_limit_then_refuses_with_the_wait() -> None:
    clock = Clock()
    limiter = RateLimiter(limit=2, window_seconds=60.0, clock=clock)
    assert limiter.hit("a") is None
    clock.now += 10
    assert limiter.hit("a") is None
    clock.now += 5
    # The first hit leaves the window 60 seconds after it landed, 45 from now.
    assert limiter.hit("a") == pytest.approx(45.0)


def test_a_refused_hit_does_not_count() -> None:
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60.0, clock=clock)
    assert limiter.hit("a") is None
    clock.now += 30
    assert limiter.hit("a") is not None
    clock.now += 30
    assert limiter.hit("a") is None


def test_counts_each_key_apart() -> None:
    limiter = RateLimiter(limit=1, window_seconds=60.0, clock=Clock())
    assert limiter.hit("a") is None
    assert limiter.hit("b") is None
    assert limiter.hit("a") is not None


def test_forgets_a_key_whose_hits_have_all_left_the_window() -> None:
    clock = Clock()
    limiter = RateLimiter(limit=1, window_seconds=60.0, clock=clock)
    limiter.hit("a")
    clock.now += 61
    limiter.hit("b")
    assert limiter.tracked == 1


@pytest.mark.anyio
async def test_resolve_endpoint_refuses_past_the_limit(app, client, auth_headers, mock_http):
    app.state.link_resolve_limiter = RateLimiter(limit=1, window_seconds=60.0)
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    body = {"url": "https://youtu.be/dQw4w9WgXcQ"}

    first = await client.post("/v1/links/resolve", json=body, headers=auth_headers("user_a"))
    second = await client.post("/v1/links/resolve", json=body, headers=auth_headers("user_a"))
    other = await client.post("/v1/links/resolve", json=body, headers=auth_headers("user_b"))

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.headers["content-type"] == "application/problem+json"
    assert 0 < int(second.headers["retry-after"]) <= 60
    assert other.status_code == 200
    # The refused call fetched nothing.
    assert sum("oembed" in str(call.url) for call in mock_http.calls) == 2
