"""Search adapters turn each service's answer into links identical to a paste of the same URL."""

from __future__ import annotations

import json
from pathlib import Path
from typing import TYPE_CHECKING, Any

import httpx2
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from pydantic import SecretStr

from crosstune.http import BlockedAddressError
from crosstune.links.detect import detect_provider, normalize_url
from crosstune.links.search import apple_music, internet_archive, tidal
from crosstune.links.search.backoff import Backoff
from crosstune.links.search.registry import SearchTokens, adapters, search_url
from crosstune.links.search.tokens import TIDAL_TOKEN_URL, AppleMusicToken, TidalToken
from crosstune.links.search.types import SearchAuthError, SearchHit
from crosstune.vocabulary import SEARCHABLE_PROVIDERS, Provider

if TYPE_CHECKING:
    from crosstune.config import Settings
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

FIXTURES = Path(__file__).parent / "fixtures" / "search"
APPLE_SEARCH = "https://api.music.apple.com/v1/catalog/"
TIDAL_SEARCH = "https://openapi.tidal.com/v2/searchResults"
TIDAL_TRACKS = "https://openapi.tidal.com/v2/tracks"
ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php"
TIMEOUT = 5.0
AWKWARD_QUERY = "The Silver Spear / Port na bPúcaí"


def _fixture(name: str) -> Any:
    return json.loads((FIXTURES / f"{name}.json").read_text())


def _tidal_matches(body: Any) -> list[Any]:
    """The search result's ordered track references in a TIDAL search body."""
    return body["data"][0]["relationships"]["tracks"]["data"]


def _pem() -> str:
    return (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )


@pytest.fixture
def apple_token() -> AppleMusicToken:
    return AppleMusicToken(team_id="TEAM123456", key_id="KEY1234567", private_key=_pem())


@pytest.fixture
def tidal_token(mock_http: MockHttp) -> TidalToken:
    mock_http.add(
        TIDAL_TOKEN_URL,
        httpx2.Response(200, json={"access_token": "tidal-access", "expires_in": 86_400}),
    )
    return TidalToken(client_id="id", client_secret="secret")


def _sent(mock_http: MockHttp, prefix: str) -> list[httpx2.Request]:
    return [call for call in mock_http.calls if str(call.url).startswith(prefix)]


def _assert_paste_identical(hit: SearchHit) -> None:
    provider, ref = detect_provider(hit.url)
    assert (hit.url, hit.provider, hit.provider_ref) == (
        normalize_url(hit.url, provider, ref),
        provider,
        ref,
    )


async def test_apple_music_hits_are_normalized_links(
    mock_http: MockHttp, apple_token: AppleMusicToken
) -> None:
    body = _fixture("apple_music")
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=body))
    async with mock_http.client() as client:
        hits = (await apple_music.adapter(apple_token)("silver spear", "US", client, TIMEOUT)).hits

    songs = body["results"]["songs"]["data"]
    assert len(hits) == len(songs) == 3
    for hit, song in zip(hits, songs, strict=True):
        attributes = song["attributes"]
        _assert_paste_identical(hit)
        assert hit.provider == "apple_music"
        assert hit.provider_ref == song["id"]
        assert hit.title == attributes["name"]
        assert hit.subtitle == f"{attributes['artistName']} · {attributes['albumName']}"
        assert hit.artwork_url == attributes["artwork"]["url"].replace("{w}x{h}", "300x300")


async def test_apple_music_uses_lowercase_storefront_and_bearer_token(
    mock_http: MockHttp, apple_token: AppleMusicToken
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=_fixture("apple_music")))
    async with mock_http.client() as client:
        await apple_music.adapter(apple_token)("silver spear", "IE", client, TIMEOUT)

    request = mock_http.calls[-1]
    assert request.url.path == "/v1/catalog/ie/search"
    assert request.url.params["types"] == "songs"
    assert request.url.params["limit"] == "10"
    assert request.headers["Authorization"] == f"Bearer {apple_token.get()}"


async def test_apple_music_with_no_songs_is_empty(
    mock_http: MockHttp, apple_token: AppleMusicToken
) -> None:
    # Apple leaves out a type's key entirely when nothing of that type matches.
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json={"results": {}}))
    async with mock_http.client() as client:
        assert (await apple_music.adapter(apple_token)("zzz", "US", client, TIMEOUT)).hits == []


async def test_tidal_hit_url_is_the_browse_track_url(
    mock_http: MockHttp, tidal_token: TidalToken
) -> None:
    body = _fixture("tidal")
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=body))
    async with mock_http.client() as client:
        hits = (
            await tidal.adapter(tidal_token, Backoff())("silver spear", "US", client, TIMEOUT)
        ).hits

    matches = _tidal_matches(body)
    assert [hit.provider_ref for hit in hits] == [f"track:{item['id']}" for item in matches]
    for hit, item in zip(hits, matches, strict=True):
        browse = f"https://tidal.com/browse/track/{item['id']}"
        assert hit.url == normalize_url(browse, *detect_provider(browse))
        _assert_paste_identical(hit)
        assert hit.provider == "tidal"
    assert [hit.title for hit in hits] == [
        "Silver Spear",
        "The Silver Spear (Live)",
        "Silver Spear / The Mason's Apron",
    ]
    [request] = _sent(mock_http, TIDAL_SEARCH)
    assert request.url.path == "/v2/searchResults"
    assert request.url.params["filter[query]"] == "silver spear"
    assert request.url.params["countryCode"] == "US"
    assert request.url.params["include"] == "tracks"
    assert request.headers["Authorization"] == "Bearer tidal-access"


async def test_tidal_hits_carry_their_artists(mock_http: MockHttp, tidal_token: TidalToken) -> None:
    body = _fixture("tidal")
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=body))
    mock_http.add(TIDAL_TRACKS, httpx2.Response(200, json=_fixture("tidal_tracks")))
    async with mock_http.client() as client:
        hits = (
            await tidal.adapter(tidal_token, Backoff())("silver spear", "IE", client, TIMEOUT)
        ).hits

    assert [hit.subtitle for hit in hits] == [
        "Kevin Burke",
        "The Chieftains, Matt Molloy",
        None,
    ]
    [lookup] = _sent(mock_http, TIDAL_TRACKS)
    assert lookup.url.params.get_list("filter[id]") == [item["id"] for item in _tidal_matches(body)]
    assert lookup.url.params["include"] == "artists"
    assert lookup.url.params["countryCode"] == "IE"
    assert lookup.headers["Authorization"] == "Bearer tidal-access"


@pytest.mark.parametrize("answer", [httpx2.Response(500), httpx2.Response(200, text="<html>")])
async def test_tidal_hits_stay_title_only_when_the_artist_lookup_fails(
    mock_http: MockHttp, tidal_token: TidalToken, answer: httpx2.Response
) -> None:
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=_fixture("tidal")))
    mock_http.add(TIDAL_TRACKS, answer)
    async with mock_http.client() as client:
        hits = (
            await tidal.adapter(tidal_token, Backoff())("silver spear", "US", client, TIMEOUT)
        ).hits

    assert [hit.title for hit in hits] == [
        "Silver Spear",
        "The Silver Spear (Live)",
        "Silver Spear / The Mason's Apron",
    ]
    assert all(hit.subtitle is None for hit in hits)


async def test_tidal_hits_stay_title_only_when_the_artist_lookup_cannot_connect(
    mock_http: MockHttp, tidal_token: TidalToken
) -> None:
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=_fixture("tidal")))

    def handler(request: httpx2.Request) -> httpx2.Response:
        # The outbound client raises this for a failed lookup or a refused address.
        if str(request.url).startswith(TIDAL_TRACKS):
            msg = "openapi.tidal.com did not resolve"
            raise BlockedAddressError(msg)
        return mock_http.handler(request)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handler)) as client:
        hits = (
            await tidal.adapter(tidal_token, Backoff())("silver spear", "US", client, TIMEOUT)
        ).hits

    assert len(hits) == 3
    assert all(hit.subtitle is None for hit in hits)


async def test_tidal_artist_lookup_429_holds_tidal(
    mock_http: MockHttp, tidal_token: TidalToken
) -> None:
    now = 1000.0
    backoff = Backoff(clock=lambda: now)
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=_fixture("tidal")))
    mock_http.add(TIDAL_TRACKS, httpx2.Response(429, headers={"Retry-After": "30"}))
    async with mock_http.client() as client:
        hits = (
            await tidal.adapter(tidal_token, backoff)("silver spear", "US", client, TIMEOUT)
        ).hits

    assert len(hits) == 3
    assert all(hit.subtitle is None for hit in hits)
    assert backoff.held(Provider.TIDAL)
    now += 31
    assert not backoff.held(Provider.TIDAL)


async def test_tidal_with_no_tracks_skips_the_artist_lookup(
    mock_http: MockHttp, tidal_token: TidalToken
) -> None:
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json={"data": [], "included": []}))
    async with mock_http.client() as client:
        assert (
            await tidal.adapter(tidal_token, Backoff())("zzz", "US", client, TIMEOUT)
        ).hits == []

    assert _sent(mock_http, TIDAL_TRACKS) == []


@pytest.mark.parametrize("status", [400, 404])
async def test_apple_music_retries_an_unserved_storefront_as_us(
    mock_http: MockHttp, apple_token: AppleMusicToken, status: int
) -> None:
    mock_http.add(f"{APPLE_SEARCH}xx/", httpx2.Response(status))
    mock_http.add(f"{APPLE_SEARCH}us/", httpx2.Response(200, json=_fixture("apple_music")))
    async with mock_http.client() as client:
        hits = (await apple_music.adapter(apple_token)("silver spear", "XX", client, TIMEOUT)).hits

    assert len(hits) == 3
    assert [c.url.path for c in _sent(mock_http, APPLE_SEARCH)] == [
        "/v1/catalog/xx/search",
        "/v1/catalog/us/search",
    ]


@pytest.mark.parametrize("status", [400, 404])
async def test_tidal_retries_an_unserved_country_as_us(
    mock_http: MockHttp, tidal_token: TidalToken, status: int
) -> None:
    search = f"{TIDAL_SEARCH}?filter%5Bquery%5D=silver+spear&countryCode="
    mock_http.add(f"{search}XX", httpx2.Response(status))
    mock_http.add(f"{search}US", httpx2.Response(200, json=_fixture("tidal")))
    mock_http.add(TIDAL_TRACKS, httpx2.Response(200, json=_fixture("tidal_tracks")))
    async with mock_http.client() as client:
        hits = (
            await tidal.adapter(tidal_token, Backoff())("silver spear", "XX", client, TIMEOUT)
        ).hits

    assert hits[0].subtitle == "Kevin Burke"
    assert [c.url.params["countryCode"] for c in _sent(mock_http, TIDAL_SEARCH)] == ["XX", "US"]
    [lookup] = _sent(mock_http, TIDAL_TRACKS)
    assert lookup.url.params["countryCode"] == "US"


async def test_a_us_search_that_fails_is_not_retried(
    mock_http: MockHttp, apple_token: AppleMusicToken
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(404))
    async with mock_http.client() as client:
        with pytest.raises(httpx2.HTTPStatusError):
            await apple_music.adapter(apple_token)("silver spear", "US", client, TIMEOUT)

    assert len(_sent(mock_http, APPLE_SEARCH)) == 1


async def test_internet_archive_hit_url_is_the_details_page(mock_http: MockHttp) -> None:
    body = _fixture("internet_archive")
    body["response"]["docs"][0]["creator"] = ["Kevin Burke", "Mícheál Ó Domhnaill"]
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=body))
    async with mock_http.client() as client:
        hits = (await internet_archive.search("silver spear", "US", client, TIMEOUT)).hits

    docs = body["response"]["docs"]
    assert [hit.url for hit in hits] == [
        f"https://archive.org/details/{doc['identifier']}" for doc in docs
    ]
    for hit in hits:
        _assert_paste_identical(hit)
    assert [hit.title for hit in hits] == [doc["title"] for doc in docs]
    assert [hit.subtitle for hit in hits] == [
        "Kevin Burke, Mícheál Ó Domhnaill",
        "Árd Rí Ceili Band",
        "Dab Hand",
    ]
    request = mock_http.calls[-1]
    assert request.url.params.get_list("fl[]") == ["identifier", "title", "creator"]
    assert request.url.params["rows"] == "10"
    assert request.url.params["output"] == "json"


@pytest.mark.parametrize(
    ("query", "archive_q"),
    [
        (AWKWARD_QUERY, "(the silver spear port na bpúcaí) AND mediatype:audio"),
        (".", None),
        ("..", None),
    ],
)
async def test_query_with_slash_and_non_ascii_is_encoded(
    mock_http: MockHttp,
    apple_token: AppleMusicToken,
    tidal_token: TidalToken,
    query: str,
    archive_q: str | None,
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json={"results": {}}))
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json={"data": [], "links": {"self": "/"}}))
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json={"response": {"docs": []}}))
    async with mock_http.client() as client:
        await apple_music.adapter(apple_token)(query, "US", client, TIMEOUT)
        await tidal.adapter(tidal_token, Backoff())(query, "US", client, TIMEOUT)
        await internet_archive.search(query, "US", client, TIMEOUT)

    apple = _sent(mock_http, APPLE_SEARCH)
    assert len(apple) == 1
    assert apple[0].url.params["term"] == query

    # The query is a parameter, never part of the path, so no character can change the route.
    tidal_search = _sent(mock_http, "https://openapi.tidal.com/v2/")
    assert len(tidal_search) == 1
    assert tidal_search[0].url.path == "/v2/searchResults"
    assert tidal_search[0].url.params["filter[query]"] == query

    # Words only: Internet Archive rejects a query holding a bare "/" or a quoted operator,
    # and a quoted phrase must match word for word, which a tune name with its type
    # appended rarely does.
    assert [call.url.params["q"] for call in _sent(mock_http, ARCHIVE_SEARCH)] == (
        [archive_q] if archive_q else []
    )


@pytest.mark.parametrize(
    ("query", "expected"),
    [
        ("AND OR NOT", "(and or not) AND mediatype:audio"),
        ('title:"x" mediatype:texts', "(title x mediatype texts) AND mediatype:audio"),
        ("(silver) OR spear*", "(silver or spear) AND mediatype:audio"),
        ("///", None),
    ],
)
async def test_internet_archive_query_cannot_inject_syntax(
    mock_http: MockHttp, query: str, expected: str | None
) -> None:
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json={"response": {"docs": []}}))
    async with mock_http.client() as client:
        await internet_archive.search(query, "US", client, TIMEOUT)

    sent = [call.url.params["q"] for call in _sent(mock_http, ARCHIVE_SEARCH)]
    assert sent == ([expected] if expected else [])


async def test_internet_archive_with_no_words_sends_nothing(mock_http: MockHttp) -> None:
    async with mock_http.client() as client:
        assert (await internet_archive.search("/ - !", "US", client, TIMEOUT)).hits == []
    assert not any(str(call.url).startswith(ARCHIVE_SEARCH) for call in mock_http.calls)


@pytest.mark.parametrize("status", [401, 403])
async def test_auth_failure_raises_search_auth_error(
    mock_http: MockHttp, apple_token: AppleMusicToken, tidal_token: TidalToken, status: int
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(status))
    mock_http.add(TIDAL_SEARCH, httpx2.Response(status))
    async with mock_http.client() as client:
        with pytest.raises(SearchAuthError):
            await apple_music.adapter(apple_token)("silver spear", "US", client, TIMEOUT)
        with pytest.raises(SearchAuthError):
            await tidal.adapter(tidal_token, Backoff())("silver spear", "US", client, TIMEOUT)


async def test_tidal_rejected_credentials_raise_search_auth_error(mock_http: MockHttp) -> None:
    mock_http.add(TIDAL_TOKEN_URL, httpx2.Response(401, json={"error": "invalid_client"}))
    async with mock_http.client() as client:
        with pytest.raises(SearchAuthError):
            await tidal.adapter(TidalToken(client_id="id", client_secret="bad"), Backoff())(
                "silver spear", "US", client, TIMEOUT
            )


async def test_auth_failure_drops_the_cached_token(
    mock_http: MockHttp, tidal_token: TidalToken
) -> None:
    mock_http.add(TIDAL_SEARCH, httpx2.Response(401))
    async with mock_http.client() as client:
        with pytest.raises(SearchAuthError):
            await tidal.adapter(tidal_token, Backoff())("silver spear", "US", client, TIMEOUT)
        await tidal_token.get(client, TIMEOUT)

    token_calls = [call for call in mock_http.calls if str(call.url) == TIDAL_TOKEN_URL]
    assert len(token_calls) == 2


async def test_server_error_is_not_an_auth_error(
    mock_http: MockHttp, apple_token: AppleMusicToken
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(503))
    async with mock_http.client() as client:
        with pytest.raises(httpx2.HTTPStatusError):
            await apple_music.adapter(apple_token)("silver spear", "US", client, TIMEOUT)


async def test_timeout_propagates(apple_token: AppleMusicToken) -> None:
    def timeout(request: httpx2.Request) -> httpx2.Response:
        msg = "slow"
        raise httpx2.ReadTimeout(msg, request=request)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(timeout)) as client:
        with pytest.raises(httpx2.TimeoutException):
            await apple_music.adapter(apple_token)("silver spear", "US", client, TIMEOUT)


async def test_duplicate_urls_collapse(
    mock_http: MockHttp, apple_token: AppleMusicToken, tidal_token: TidalToken
) -> None:
    apple = _fixture("apple_music")
    songs = apple["results"]["songs"]["data"]
    tracking = {**songs[0], "attributes": {**songs[0]["attributes"]}}
    tracking["attributes"]["url"] += "&utm_source=x"
    tracking["attributes"]["name"] = "Later copy"
    songs.insert(1, tracking)
    tidal_body = _fixture("tidal")
    _tidal_matches(tidal_body).insert(1, _tidal_matches(tidal_body)[0])
    archive = _fixture("internet_archive")
    archive["response"]["docs"].append({**archive["response"]["docs"][0], "title": "Later copy"})
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=apple))
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=tidal_body))
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=archive))
    async with mock_http.client() as client:
        apple_hits = (await apple_music.adapter(apple_token)("q", "US", client, TIMEOUT)).hits
        tidal_hits = (await tidal.adapter(tidal_token, Backoff())("q", "US", client, TIMEOUT)).hits
        archive_hits = (await internet_archive.search("q", "US", client, TIMEOUT)).hits

    for hits in (apple_hits, tidal_hits, archive_hits):
        assert len(hits) == 3
        assert len({hit.url for hit in hits}) == 3
        assert "Later copy" not in {hit.title for hit in hits}
    assert apple_hits[0].url == songs[0]["attributes"]["url"]
    assert apple_hits[0].title == songs[0]["attributes"]["name"]
    assert archive_hits[0].title == archive["response"]["docs"][0]["title"]
    assert [hit.provider_ref for hit in tidal_hits] == [
        f"track:{ref['id']}" for ref in _tidal_matches(_fixture("tidal"))
    ]


async def test_fields_are_trimmed(mock_http: MockHttp, apple_token: AppleMusicToken) -> None:
    apple = _fixture("apple_music")
    attributes = apple["results"]["songs"]["data"][0]["attributes"]
    attributes["name"] = "  Silver Spear\n"
    attributes["artistName"] = " Slainte "
    attributes["url"] = f" {attributes['url']} "
    archive = _fixture("internet_archive")
    archive["response"]["docs"][0]["creator"] = ["  Kevin Burke ", "   "]
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=apple))
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=archive))
    async with mock_http.client() as client:
        apple_hit = (await apple_music.adapter(apple_token)("q", "US", client, TIMEOUT)).hits[0]
        archive_hit = (await internet_archive.search("q", "US", client, TIMEOUT)).hits[0]

    assert apple_hit.title == "Silver Spear"
    assert apple_hit.subtitle == f"Slainte · {attributes['albumName']}"
    assert apple_hit.url == attributes["url"].strip()
    assert archive_hit.subtitle == "Kevin Burke"


async def test_hits_cap_at_ten(mock_http: MockHttp) -> None:
    docs = [{"identifier": f"item-{n}", "title": f"Reel {n}"} for n in range(15)]
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json={"response": {"docs": docs}}))
    async with mock_http.client() as client:
        hits = (await internet_archive.search("reel", "US", client, TIMEOUT)).hits
    assert [hit.title for hit in hits] == [f"Reel {n}" for n in range(10)]


async def test_malformed_items_are_skipped(
    mock_http: MockHttp, apple_token: AppleMusicToken, tidal_token: TidalToken
) -> None:
    apple = _fixture("apple_music")
    songs = apple["results"]["songs"]["data"]
    songs[0]["attributes"].pop("name")
    songs[1]["attributes"]["url"] = "https://example.com/not-apple"
    songs.append("not an object")
    tidal_body = _fixture("tidal")
    tidal_body["included"][0]["attributes"]["title"] = ""
    _tidal_matches(tidal_body).append({"id": "999", "type": "tracks"})
    _tidal_matches(tidal_body).append({"id": "5", "type": "videos"})
    archive = _fixture("internet_archive")
    docs = archive["response"]["docs"]
    docs[0].pop("identifier")
    docs[1]["title"] = ["Dublin Dance Date"]
    docs[2]["identifier"] = "has spaces/and slashes"
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=apple))
    mock_http.add(TIDAL_SEARCH, httpx2.Response(200, json=tidal_body))
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=archive))
    async with mock_http.client() as client:
        apple_hits = (await apple_music.adapter(apple_token)("q", "US", client, TIMEOUT)).hits
        tidal_hits = (await tidal.adapter(tidal_token, Backoff())("q", "US", client, TIMEOUT)).hits
        archive_hits = (await internet_archive.search("q", "US", client, TIMEOUT)).hits

    assert [hit.provider_ref for hit in apple_hits] == [songs[2]["id"]]
    assert [hit.provider_ref for hit in tidal_hits] == [
        f"track:{_tidal_matches(tidal_body)[1]['id']}",
        f"track:{_tidal_matches(tidal_body)[2]['id']}",
    ]
    assert [hit.title for hit in archive_hits] == ["Dublin Dance Date"]


@pytest.mark.parametrize(
    "body", [[], {"results": []}, {"results": {"songs": {"data": {}}}}, {"data": None}]
)
async def test_unexpected_shapes_are_empty(
    mock_http: MockHttp, apple_token: AppleMusicToken, tidal_token: TidalToken, body: object
) -> None:
    for prefix in (APPLE_SEARCH, TIDAL_SEARCH, ARCHIVE_SEARCH):
        mock_http.add(prefix, httpx2.Response(200, json=body))
    async with mock_http.client() as client:
        assert (await apple_music.adapter(apple_token)("q", "US", client, TIMEOUT)).hits == []
        assert (await tidal.adapter(tidal_token, Backoff())("q", "US", client, TIMEOUT)).hits == []
        assert (await internet_archive.search("q", "US", client, TIMEOUT)).hits == []


async def test_body_that_is_not_json_raises(mock_http: MockHttp) -> None:
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, text="<html>busy</html>"))
    async with mock_http.client() as client:
        with pytest.raises(ValueError, match="Expecting value"):
            await internet_archive.search("q", "US", client, TIMEOUT)


@pytest.mark.parametrize(
    ("provider", "expected"),
    [
        (
            Provider.APPLE_MUSIC,
            "https://music.apple.com/ie/search?term=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
        (
            Provider.TIDAL,
            "https://listen.tidal.com/search?q=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
        (
            Provider.INTERNET_ARCHIVE,
            "https://archive.org/search?query=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
        (
            Provider.YOUTUBE,
            "https://www.youtube.com/results?search_query=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
        (
            Provider.SPOTIFY,
            "https://open.spotify.com/search/The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
        (
            Provider.BANDCAMP,
            "https://bandcamp.com/search?q=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD&item_type=t",
        ),
        (
            Provider.SOUNDCLOUD,
            "https://soundcloud.com/search/sounds?q=The%20Silver%20Spear%20%2F%20Port%20na%20bP%C3%BAca%C3%AD",
        ),
    ],
)
def test_search_url_for_every_searchable_provider(provider: Provider, expected: str) -> None:
    assert search_url(provider, AWKWARD_QUERY, "IE") == expected


def test_search_url_covers_every_searchable_provider() -> None:
    for provider in SEARCHABLE_PROVIDERS:
        assert search_url(provider, "q", "US").startswith("https://")
    with pytest.raises(KeyError):
        search_url(Provider.OTHER, "q", "US")


def test_adapters_only_include_configured_services(settings: Settings) -> None:
    bare = settings.model_copy(
        update={
            "apple_music_team_id": "",
            "apple_music_key_id": "",
            "tidal_client_id": "",
        }
    )
    tokens = SearchTokens.from_settings(bare)
    assert tokens == SearchTokens(apple_music=None, tidal=None)
    assert list(adapters(bare, tokens, Backoff())) == [Provider.INTERNET_ARCHIVE]

    full = settings.model_copy(
        update={
            "apple_music_team_id": "TEAM123456",
            "apple_music_key_id": "KEY1234567",
            "apple_music_private_key": SecretStr(_pem()),
            "tidal_client_id": "id",
            "tidal_client_secret": SecretStr("secret"),
        }
    )
    tokens = SearchTokens.from_settings(full)
    assert isinstance(tokens.apple_music, AppleMusicToken)
    assert isinstance(tokens.tidal, TidalToken)
    assert list(adapters(full, tokens, Backoff())) == [
        Provider.APPLE_MUSIC,
        Provider.TIDAL,
        Provider.INTERNET_ARCHIVE,
    ]
