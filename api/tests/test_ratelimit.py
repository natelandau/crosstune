"""A caller gets a fixed number of hits per sliding window, then a wait."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.ratelimit import RateLimiter
from tests.test_push import T0, change, push, uid
from tests.test_resolve import OEMBED, og_html


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


@pytest.mark.anyio
async def test_push_resolves_links_only_within_the_callers_limit(
    app, client, auth_headers, mock_http
):
    app.state.link_resolve_limiter = RateLimiter(limit=2, window_seconds=60.0)
    urls = [f"https://band{n}.bandcamp.com/track/a" for n in range(5)]
    for url in urls:
        mock_http.add(url, httpx2.Response(200, text=og_html("Title")))
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        *[
            change("recording_links", uid(), T0, song_id=song, url=url, provider="bandcamp")
            for url in urls
        ],
    )
    assert [r["status"] for r in results] == ["applied"] * 6
    # Past the limit a link is stored untitled, exactly as when its fetch fails.
    assert sorted(r["row"]["title"] is not None for r in results[1:]) == [False] * 3 + [True] * 2
    assert sum("bandcamp" in str(call.url) for call in mock_http.calls) == 2


@pytest.mark.anyio
async def test_push_and_the_resolve_route_share_one_limit(app, client, auth_headers, mock_http):
    app.state.link_resolve_limiter = RateLimiter(limit=1, window_seconds=60.0)
    url = "https://one.bandcamp.com/track/a"
    mock_http.add(url, httpx2.Response(200, text=og_html("One")))
    song = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change("recording_links", uid(), T0, song_id=song, url=url, provider="bandcamp"),
    )
    response = await client.post(
        "/v1/links/resolve", json={"url": url}, headers=auth_headers("user_a")
    )
    assert response.status_code == 429
