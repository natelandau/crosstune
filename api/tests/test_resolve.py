"""Resolvers fetch a title and artwork, and never raise."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.links import resolve as resolve_module
from crosstune.links.opengraph import PageMeta, parse_open_graph
from crosstune.links.resolve import MAX_JSON_BYTES, MAX_PAGE_BYTES, resolve_link
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
    assert parse_open_graph(OG_HTML) == PageMeta(
        title="Sally Ann | Fiddler", image="https://f4.bcbits.com/img/a.jpg", bandcamp_ref=None
    )


def test_parse_open_graph_falls_back_to_title_tag() -> None:
    assert parse_open_graph("<html><head><title>Just a title</title></head></html>") == PageMeta(
        title="Just a title", image=None, bandcamp_ref=None
    )


@pytest.mark.parametrize(
    ("content", "ref"),
    [
        ("{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:84352595}", "album:84352595"),
        ("{&quot;item_type&quot;:&quot;t&quot;,&quot;item_id&quot;:2417374}", "track:2417374"),
        ("{&quot;item_type&quot;:&quot;b&quot;,&quot;item_id&quot;:1}", None),
        ("{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:&quot;x&quot;}", None),
        ("{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:true}", None),
        ("not json", None),
    ],
)
def test_parse_open_graph_reads_the_bandcamp_item(content: str, ref: str | None) -> None:
    html = f'<html><head><meta name="bc-page-properties" content="{content}"></head></html>'
    assert parse_open_graph(html).bandcamp_ref == ref


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

    def spy(html: str) -> PageMeta:
        parsed.append(len(html))
        return real_parse(html)

    monkeypatch.setattr(resolve_module, "parse_open_graph", spy)
    huge = OG_HTML + "<p>" + "x" * (4 * MAX_PAGE_BYTES) + "</p>"
    mock_http.add("https://fiddler.bandcamp.com/track/huge", httpx2.Response(200, text=huge))
    async with mock_http.client() as client:
        link = await resolve_link("https://fiddler.bandcamp.com/track/huge", client, timeout=5.0)
    assert link.title == "Sally Ann | Fiddler"
    assert parsed == [MAX_PAGE_BYTES]


@pytest.mark.parametrize(
    ("endpoint", "body", "url"),
    [
        (
            "https://www.youtube.com/oembed",
            OEMBED,
            "https://youtu.be/dQw4w9WgXcQ",
        ),
        (
            "https://itunes.apple.com/lookup",
            ITUNES,
            "https://music.apple.com/us/album/x/1440935467?i=1440935474",
        ),
        (
            "https://archive.org/metadata/sleepy-marlin-soldiers-joy/metadata",
            {"result": {"title": "Soldier's Joy"}},
            "https://archive.org/details/sleepy-marlin-soldiers-joy",
        ),
    ],
    ids=["oembed", "itunes", "internet archive"],
)
async def test_json_resolver_refuses_a_body_over_the_byte_cap(
    mock_http, endpoint: str, body: dict, url: str
) -> None:
    mock_http.add(endpoint, httpx2.Response(200, json={**body, "padding": "x" * MAX_JSON_BYTES}))
    async with mock_http.client() as client:
        link = await resolve_link(url, client, timeout=5.0)
    assert link.title is None
    assert link.artwork_url is None


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
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
            url="https://youtu.be/dQw4w9WgXcQ",
            provider="youtube",
        ),
    )
    assert results[1]["status"] == "applied"
    assert results[1]["row"]["title"] == OEMBED["title"]


async def test_push_keeps_client_title(client, auth_headers, mock_http) -> None:
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
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
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        *[
            change("recording_links", uid(), T0, tune_id=tune, url=url, provider="bandcamp")
            for url in titles
        ],
    )
    assert [r["status"] for r in results] == ["applied"] * 4
    assert {r["row"]["url"]: r["row"]["title"] for r in results[1:]} == titles


async def test_push_stores_an_unresolvable_link_untitled(client, auth_headers, mock_http):
    good = "https://good.bandcamp.com/track/a"
    bad = "https://bad.bandcamp.com/track/b"
    mock_http.add(good, httpx2.Response(200, text=og_html("Good")))
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change("recording_links", uid(), T0, tune_id=tune, url=good, provider="bandcamp"),
        change("recording_links", uid(), T0, tune_id=tune, url=bad, provider="bandcamp"),
    )
    assert [r["status"] for r in results] == ["applied"] * 3
    assert {r["row"]["url"]: r["row"]["title"] for r in results[1:]} == {good: "Good", bad: None}


async def test_push_stores_the_canonical_url_of_an_enriched_link(client, auth_headers, mock_http):
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
            url="https://youtu.be/dQw4w9WgXcQ?t=42",
            provider="youtube",
        ),
    )
    row = results[1]["row"]
    assert row["url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert row["provider_ref"] == "dQw4w9WgXcQ"
    assert row["title"] == OEMBED["title"]


BANDCAMP_HTML = """<html><head>
<meta property="og:title" content="Live On Red Barn Radio II, by Tyler Childers">
<meta name="bc-page-properties" content="{&quot;item_type&quot;:&quot;a&quot;,&quot;item_id&quot;:84352595}">
</head></html>"""
ARCHIVE_ID = "78_soldiers-joy_sleepy-marlin_gbia0506187b"


async def test_bandcamp_resolution_stores_the_embed_id(mock_http) -> None:
    mock_http.add(
        "https://tylerchilders.bandcamp.com/album/live", httpx2.Response(200, text=BANDCAMP_HTML)
    )
    async with mock_http.client() as client:
        link = await resolve_link(
            "https://tylerchilders.bandcamp.com/album/live", client, timeout=5.0
        )
    assert link.provider == "bandcamp"
    assert link.provider_ref == "album:84352595"
    assert link.title == "Live On Red Barn Radio II, by Tyler Childers"


async def test_tidal_uses_open_graph(mock_http) -> None:
    mock_http.add(
        "https://tidal.com/track/45670321",
        httpx2.Response(200, text=og_html("The Doc Watson Family &amp; Doc Watson - Ground Hog")),
    )
    async with mock_http.client() as client:
        link = await resolve_link("https://tidal.com/track/45670321/u", client, timeout=5.0)
    assert link.provider == "tidal"
    assert link.provider_ref == "track:45670321"
    assert link.url == "https://tidal.com/track/45670321"
    assert link.title == "The Doc Watson Family & Doc Watson - Ground Hog"


async def test_internet_archive_uses_the_metadata_api(mock_http) -> None:
    mock_http.add(
        f"https://archive.org/metadata/{ARCHIVE_ID}/metadata",
        httpx2.Response(
            200, json={"result": {"title": "SOLDIER'S JOY", "creator": "SLEEPY MARLIN"}}
        ),
    )
    async with mock_http.client() as client:
        link = await resolve_link(
            f"https://archive.org/details/{ARCHIVE_ID}/file.flac", client, timeout=5.0
        )
    assert link.provider == "internet_archive"
    assert link.provider_ref == ARCHIVE_ID
    assert link.url == f"https://archive.org/details/{ARCHIVE_ID}"
    assert link.title == "SOLDIER'S JOY - SLEEPY MARLIN"
    assert link.artwork_url == f"https://archive.org/services/img/{ARCHIVE_ID}"


async def test_internet_archive_takes_the_first_of_array_fields(mock_http) -> None:
    mock_http.add(
        f"https://archive.org/metadata/{ARCHIVE_ID}/metadata",
        httpx2.Response(200, json={"result": {"title": ["Soldier's Joy", "Alternate"]}}),
    )
    async with mock_http.client() as client:
        link = await resolve_link(f"https://archive.org/details/{ARCHIVE_ID}", client, timeout=5.0)
    assert link.title == "Soldier's Joy"


@pytest.mark.parametrize(
    "body", [{"result": {}}, {"error": f"Couldn't locate item '{ARCHIVE_ID}'"}]
)
async def test_internet_archive_yields_nothing_for_a_missing_item(mock_http, body) -> None:
    mock_http.add(
        f"https://archive.org/metadata/{ARCHIVE_ID}/metadata", httpx2.Response(200, json=body)
    )
    async with mock_http.client() as client:
        link = await resolve_link(f"https://archive.org/details/{ARCHIVE_ID}", client, timeout=5.0)
    assert link.title is None
    assert link.artwork_url is None


@pytest.mark.parametrize(
    "response",
    [httpx2.Response(500), httpx2.Response(200, json=["not", "an", "object"])],
    ids=["server error", "non-object json"],
)
async def test_internet_archive_failure_yields_no_title_or_artwork(mock_http, response) -> None:
    mock_http.add(f"https://archive.org/metadata/{ARCHIVE_ID}/metadata", response)
    async with mock_http.client() as client:
        link = await resolve_link(f"https://archive.org/details/{ARCHIVE_ID}", client, timeout=5.0)
    assert link.provider_ref == ARCHIVE_ID
    assert link.title is None
    assert link.artwork_url is None


async def test_bandcamp_page_failure_yields_no_title_or_ref(mock_http) -> None:
    mock_http.add("https://tylerchilders.bandcamp.com/album/live", httpx2.Response(500))
    async with mock_http.client() as client:
        link = await resolve_link(
            "https://tylerchilders.bandcamp.com/album/live", client, timeout=5.0
        )
    assert link.provider == "bandcamp"
    assert link.title is None
    assert link.provider_ref is None


async def test_push_detects_the_provider_of_a_titled_link_sent_as_other(
    client, auth_headers, mock_http
):
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
            url="https://tidal.com/browse/track/45670321/u",
            provider="other",
            title="Ground Hog",
        ),
    )
    row = results[1]["row"]
    assert row["provider"] == "tidal"
    assert row["provider_ref"] == "track:45670321"
    assert row["url"] == "https://tidal.com/track/45670321"
    assert row["title"] == "Ground Hog"
    assert not any("tidal" in str(call.url) for call in mock_http.calls)


async def test_push_stores_the_bandcamp_embed_id(client, auth_headers, mock_http):
    url = "https://tylerchilders.bandcamp.com/album/live"
    mock_http.add(url, httpx2.Response(200, text=BANDCAMP_HTML))
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change("recording_links", uid(), T0, tune_id=tune, url=url, provider="bandcamp"),
    )
    assert results[1]["row"]["provider_ref"] == "album:84352595"


async def test_open_graph_follows_a_public_redirect(mock_http) -> None:
    mock_http.add(
        "https://short.example/x",
        httpx2.Response(302, headers={"Location": "https://long.example/track"}),
    )
    mock_http.add("https://long.example/track", httpx2.Response(200, text=og_html("Cluck Old Hen")))
    async with mock_http.client() as client:
        link = await resolve_link("https://short.example/x", client, timeout=5.0)
    assert link.title == "Cluck Old Hen"


async def test_a_link_on_a_private_address_resolves_untitled(guarded_http) -> None:
    async with guarded_http.client({"internal.example": ["10.0.0.5"]}) as client:
        link = await resolve_link("https://internal.example/tune", client, timeout=5.0)
    assert link.provider == "other"
    assert link.url == "https://internal.example/tune"
    assert link.title is None
    assert guarded_http.calls == []


async def test_a_link_that_redirects_to_a_private_address_resolves_untitled(guarded_http) -> None:
    guarded_http.add(
        "https://public.example/",
        httpx2.Response(302, headers={"Location": "http://169.254.169.254/latest/meta-data/"}),
    )
    async with guarded_http.client({"public.example": ["93.184.216.34"]}) as client:
        link = await resolve_link("https://public.example/", client, timeout=5.0)
    assert link.title is None
    assert [str(call.url) for call in guarded_http.calls] == ["https://93.184.216.34/"]


def _pool_watching_client(engine, mock_http, seen: list[int]) -> httpx2.AsyncClient:
    """An outbound client that notes how many pooled connections are out at each provider call."""

    def handler(request: httpx2.Request) -> httpx2.Response:
        if "oembed" in str(request.url):
            seen.append(engine.pool.checkedout())
        return mock_http.handler(request)

    return httpx2.AsyncClient(transport=httpx2.MockTransport(handler))


async def test_resolve_endpoint_holds_no_connection_while_it_fetches(
    app, client, auth_headers, mock_http, engine
) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    seen: list[int] = []
    app.state.http_client = _pool_watching_client(engine, mock_http, seen)
    response = await client.post(
        "/v1/links/resolve",
        json={"url": "https://youtu.be/dQw4w9WgXcQ"},
        headers=auth_headers("user_a"),
    )
    assert response.status_code == 200
    assert seen == [0]


async def test_push_holds_no_connection_while_it_resolves_links(
    app, client, auth_headers, mock_http, engine
) -> None:
    mock_http.add("https://www.youtube.com/oembed", httpx2.Response(200, json=OEMBED))
    seen: list[int] = []
    app.state.http_client = _pool_watching_client(engine, mock_http, seen)
    tune = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change(
            "recording_links",
            uid(),
            T0,
            tune_id=tune,
            url="https://youtu.be/dQw4w9WgXcQ",
            provider="youtube",
        ),
    )
    assert [r["status"] for r in results] == ["applied", "applied"]
    assert seen == [0]
