"""Resolvers fetch a title and artwork, and never raise."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.links import resolve as resolve_module
from crosstune.links.opengraph import parse_open_graph
from crosstune.links.resolve import MAX_PAGE_BYTES, resolve_link
from tests.test_push import T0, change, push, uid

pytestmark = pytest.mark.anyio

OEMBED = {
    "title": "Angeline the Baker - Old Time Fiddle",
    "thumbnail_url": "https://i.ytimg.com/vi/x/hq.jpg",
}
ITUNES = {
    "results": [
        {
            "trackName": "Angeline the Baker",
            "artistName": "Bruce Molsky",
            "artworkUrl100": "https://a.mzstatic.com/x.jpg",
        }
    ]
}
OG_HTML = """<html><head><title>fallback</title>
<meta property="og:title" content="Sally Ann | Fiddler" />
<meta content="https://f4.bcbits.com/img/a.jpg" property="og:image">
</head><body></body></html>"""


def test_parse_open_graph_prefers_og_title() -> None:
    assert parse_open_graph(OG_HTML) == ("Sally Ann | Fiddler", "https://f4.bcbits.com/img/a.jpg")


def test_parse_open_graph_falls_back_to_title_tag() -> None:
    assert parse_open_graph("<html><head><title>Just a title</title></head></html>") == (
        "Just a title",
        None,
    )


async def test_youtube_uses_oembed(mock_http) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    async with mock_http.client() as client:
        link = await resolve_link("https://youtu.be/dQw4w9WgXcQ", client, timeout=5.0)
    assert link.provider == "youtube"
    assert link.provider_ref == "dQw4w9WgXcQ"
    assert link.url == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert link.title == OEMBED["title"]
    assert link.artwork_url == OEMBED["thumbnail_url"]


async def test_spotify_uses_oembed(mock_http) -> None:
    mock_http.add("https://open.spotify.com/oembed", httpx2.Response(200, json=OEMBED))
    async with mock_http.client() as client:
        link = await resolve_link(
            "https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp", client, timeout=5.0
        )
    assert link.title == OEMBED["title"]


async def test_apple_music_uses_itunes_lookup(mock_http) -> None:
    mock_http.add("https://itunes.apple.com/lookup", httpx2.Response(200, json=ITUNES))
    async with mock_http.client() as client:
        link = await resolve_link(
            "https://music.apple.com/us/album/x/1440935467?i=1440935474", client, timeout=5.0
        )
    assert link.title == "Angeline the Baker - Bruce Molsky"
    assert link.artwork_url == "https://a.mzstatic.com/x.jpg"
    assert "id=1440935474" in str(mock_http.calls[-1].url)


async def test_bandcamp_uses_open_graph(mock_http) -> None:
    mock_http.add(
        "https://fiddler.bandcamp.com/track/sally-ann", httpx2.Response(200, text=OG_HTML)
    )
    async with mock_http.client() as client:
        link = await resolve_link(
            "https://fiddler.bandcamp.com/track/sally-ann", client, timeout=5.0
        )
    assert link.title == "Sally Ann | Fiddler"


async def test_open_graph_reads_no_more_than_the_byte_cap(mock_http, monkeypatch) -> None:
    parsed: list[int] = []
    real_parse = resolve_module.parse_open_graph

    def spy(html: str) -> tuple[str | None, str | None]:
        parsed.append(len(html))
        return real_parse(html)

    monkeypatch.setattr(resolve_module, "parse_open_graph", spy)
    huge = OG_HTML + "<p>" + "x" * (4 * MAX_PAGE_BYTES) + "</p>"
    mock_http.add("https://fiddler.bandcamp.com/track/huge", httpx2.Response(200, text=huge))
    async with mock_http.client() as client:
        link = await resolve_link("https://fiddler.bandcamp.com/track/huge", client, timeout=5.0)
    assert link.title == "Sally Ann | Fiddler"
    assert parsed == [MAX_PAGE_BYTES]


async def test_failure_returns_untitled_link(mock_http) -> None:
    def boom(request: httpx2.Request) -> httpx2.Response:
        msg = "slow"
        raise httpx2.ConnectTimeout(msg, request=request)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(boom)) as client:
        link = await resolve_link("https://youtu.be/dQw4w9WgXcQ", client, timeout=5.0)
    assert link.provider == "youtube"
    assert link.title is None
    assert link.artwork_url is None


async def test_non_200_returns_untitled_link(mock_http) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(404))
    async with mock_http.client() as client:
        link = await resolve_link("https://youtu.be/dQw4w9WgXcQ", client, timeout=5.0)
    assert link.title is None


async def test_resolve_endpoint(client, auth_headers, mock_http) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    response = await client.post(
        "/v1/links/resolve",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
        headers=auth_headers("user_a"),
    )
    assert response.status_code == 200
    assert response.json()["title"] == OEMBED["title"]


async def test_resolve_endpoint_requires_auth(client) -> None:
    response = await client.post("/v1/links/resolve", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert response.status_code == 401


async def test_push_enriches_untitled_link(client, auth_headers, mock_http) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            song_id=song,
            url="https://youtu.be/dQw4w9WgXcQ",
            provider="youtube",
        ),
    )
    assert results[1]["status"] == "applied"
    assert results[1]["row"]["title"] == OEMBED["title"]


async def test_push_keeps_client_title(client, auth_headers, mock_http) -> None:
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            song_id=song,
            url="https://youtu.be/dQw4w9WgXcQ",
            provider="youtube",
            title="Mine",
        ),
    )
    assert results[1]["row"]["title"] == "Mine"
    assert not any("oembed" in str(c.url) for c in mock_http.calls)


def og_html(title: str) -> str:
    return f'<html><head><meta property="og:title" content="{title}" /></head></html>'


async def test_push_enriches_every_untitled_link_in_a_batch(client, auth_headers, mock_http):
    titles = {
        "https://one.bandcamp.com/track/a": "One",
        "https://two.bandcamp.com/track/b": "Two",
        "https://three.bandcamp.com/track/c": "Three",
    }
    for url, title in titles.items():
        mock_http.add(url, httpx2.Response(200, text=og_html(title)))
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        *[
            change("recording_links", uid(), T0, song_id=song, url=url, provider="bandcamp")
            for url in titles
        ],
    )
    assert [r["status"] for r in results] == ["applied"] * 4
    assert {r["row"]["url"]: r["row"]["title"] for r in results[1:]} == titles


async def test_push_stores_an_unresolvable_link_untitled(client, auth_headers, mock_http):
    good = "https://good.bandcamp.com/track/a"
    bad = "https://bad.bandcamp.com/track/b"
    mock_http.add(good, httpx2.Response(200, text=og_html("Good")))
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change("recording_links", uid(), T0, song_id=song, url=good, provider="bandcamp"),
        change("recording_links", uid(), T0, song_id=song, url=bad, provider="bandcamp"),
    )
    assert [r["status"] for r in results] == ["applied"] * 3
    assert {r["row"]["url"]: r["row"]["title"] for r in results[1:]} == {good: "Good", bad: None}


async def test_push_stores_the_canonical_url_of_an_enriched_link(client, auth_headers, mock_http):
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    song = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            song_id=song,
            url="https://youtu.be/dQw4w9WgXcQ?t=42",
            provider="youtube",
        ),
    )
    row = results[1]["row"]
    assert row["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert row["provider_ref"] == "dQw4w9WgXcQ"
    assert row["title"] == OEMBED["title"]
