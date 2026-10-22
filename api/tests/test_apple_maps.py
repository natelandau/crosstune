"""Apple Maps client: token exchange, search, and reverse geocoding."""

import httpx2
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from crosstune.places.maps import (
    MAPS_URL,
    MAX_HITS,
    AppleMaps,
    MapsBusyError,
    MapsError,
    PlaceHit,
)
from crosstune.vocabulary import LIMITS
from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

TOKEN_URL = f"{MAPS_URL}/v1/token"
SEARCH_URL = f"{MAPS_URL}/v1/searchAutocomplete"
REVERSE_URL = f"{MAPS_URL}/v1/reverseGeocode"

GALAX = {
    "name": "Galax",
    "coordinate": {"latitude": 36.6612, "longitude": -80.9239},
    "country": "United States",
    "countryCode": "US",
    "structuredAddress": {
        "locality": "Galax",
        "administrativeArea": "Virginia",
        "administrativeAreaCode": "VA",
    },
    "formattedAddressLines": ["Galax, VA", "United States"],
}
ENNIS = {
    "name": "Ennis",
    "coordinate": {"latitude": 52.8436, "longitude": -8.9864},
    "country": "Ireland",
    "countryCode": "IE",
    "structuredAddress": {"locality": "Ennis", "administrativeAreaCode": "CE"},
}


def _suggestion(*lines: str, lat: float = 36.6612, lon: float = -80.9239, **extra) -> dict:
    """An Apple Maps type-ahead suggestion."""
    return {"displayLines": list(lines), "location": {"latitude": lat, "longitude": lon}, **extra}


GALAX_HIT = _suggestion("Galax, VA", "United States")
ENNIS_HIT = _suggestion("Ennis", "Co. Clare, Ireland", lat=52.8436, lon=-8.9864)
NO_POINT = {"displayLines": ["Nowhere", "United States"]}
JALOPY_HIT = _suggestion(
    "Jalopy Theatre And School of Music",
    "315 Columbia St, Brooklyn, NY 11231, United States",
    lat=40.6845,
    lon=-74.0019,
    structuredAddress={"locality": "Brooklyn", "subLocality": "Brooklyn"},
)


def _centre_st(state: str, lat: float) -> dict:
    return _suggestion("1038 Centre St", f"Newton, {state}, United States", lat=lat, lon=-71.2)


class Clock:
    """A settable clock."""

    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


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
def clock() -> Clock:
    return Clock()


@pytest.fixture
def maps(clock: Clock) -> AppleMaps:
    return AppleMaps(team_id="TEAM123456", key_id="KEY1234567", private_key=_pem(), clock=clock)


@pytest.fixture
def http() -> MockHttp:
    http = MockHttp()
    http.add(
        TOKEN_URL,
        httpx2.Response(200, json={"accessToken": "maps-access", "expiresInSeconds": 1800}),
    )
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": [GALAX_HIT, NO_POINT, ENNIS_HIT]}))
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": [GALAX, ENNIS]}))
    return http


def _sent(http: MockHttp, prefix: str) -> list[httpx2.Request]:
    return [call for call in http.calls if str(call.url).startswith(prefix)]


async def test_token_exchange_is_cached(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country="US", timeout=5)
        await maps.search(client, "ennis", country="US", timeout=5)

    assert len(_sent(http, TOKEN_URL)) == 1
    assert _sent(http, TOKEN_URL)[0].headers["Authorization"].startswith("Bearer ey")
    searches = _sent(http, SEARCH_URL)
    assert [call.headers["Authorization"] for call in searches] == ["Bearer maps-access"] * 2


async def test_token_is_refetched_after_expiry(
    maps: AppleMaps, http: MockHttp, clock: Clock
) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country="US", timeout=5)
        clock.now += 1741
        await maps.search(client, "galax", country="US", timeout=5)

    assert len(_sent(http, TOKEN_URL)) == 2


async def test_search_returns_named_hits(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        hits = await maps.search(client, "galax", country="US", timeout=5)

    assert hits == [
        PlaceHit("Galax, VA", 36.6612, -80.9239, title="Galax, VA", kind="town"),
        PlaceHit(
            "Ennis, Co. Clare, Ireland",
            52.8436,
            -8.9864,
            title="Ennis",
            subtitle="Co. Clare, Ireland",
            kind="town",
        ),
    ]
    assert _sent(http, SEARCH_URL)[0].url.params["q"] == "galax"


async def test_search_leans_toward_the_account_country(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country="US", timeout=5)

    params = _sent(http, SEARCH_URL)[0].url.params
    assert params["resultTypeFilter"] == "poi,address"
    assert params["searchLocation"] == "39.54,-97.48"
    for hint in ("searchRegion", "userLocation", "limitToCountries"):
        assert hint not in params


@pytest.mark.parametrize("country", [None, "XX"])
async def test_search_without_a_known_country_leans_nowhere(
    maps: AppleMaps, http: MockHttp, country: str | None
) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country=country, timeout=5)

    params = _sent(http, SEARCH_URL)[0].url.params
    for hint in ("searchLocation", "searchRegion", "userLocation", "limitToCountries"):
        assert hint not in params


async def test_search_rows_leave_out_the_account_country(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        hits = await maps.search(client, "ennis", country="IE", timeout=5)

    assert hits[1] == PlaceHit(
        "Ennis, Co. Clare, Ireland",
        52.8436,
        -8.9864,
        title="Ennis",
        subtitle="Co. Clare",
        kind="town",
    )


async def test_search_names_each_hit_as_picked(maps: AppleMaps, http: MockHttp) -> None:
    results = [JALOPY_HIT, _centre_st("MA", 42.33), GALAX_HIT]
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": results}))
    async with http.client() as client:
        hits = await maps.search(client, "jalopy", country="US", timeout=5)

    assert hits == [
        PlaceHit(
            "Jalopy Theatre And School of Music, 315 Columbia St, Brooklyn, NY",
            40.6845,
            -74.0019,
            title="Jalopy Theatre And School of Music",
            subtitle="315 Columbia St, Brooklyn, NY",
            kind="venue",
            address="315 Columbia St, Brooklyn, NY",
        ),
        PlaceHit(
            "1038 Centre St, Newton, MA",
            42.33,
            -71.2,
            title="1038 Centre St",
            subtitle="Newton, MA",
            kind="address",
        ),
        PlaceHit("Galax, VA", 36.6612, -80.9239, title="Galax, VA", kind="town"),
    ]


async def test_search_lists_one_address_in_every_state(maps: AppleMaps, http: MockHttp) -> None:
    states = ["MA", "IA", "KS", "NJ", "NC"]
    results = [_centre_st(state, 40.0 + i) for i, state in enumerate(states)]
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": results}))
    async with http.client() as client:
        hits = await maps.search(client, "1038 centre street, newton", country="US", timeout=5)

    assert [hit.name for hit in hits] == [f"1038 Centre St, Newton, {state}" for state in states]
    assert [hit.subtitle for hit in hits] == [f"Newton, {state}" for state in states]


@pytest.mark.parametrize(
    "location",
    [None, {}, {"latitude": "40.1", "longitude": -74.0}, {"latitude": True, "longitude": 1.0}],
    ids=["absent", "empty", "text", "bool"],
)
async def test_search_skips_a_hit_without_coordinates(
    maps: AppleMaps, http: MockHttp, location: dict | None
) -> None:
    pointless = {**GALAX_HIT, "location": location}
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": [pointless, ENNIS_HIT]}))
    async with http.client() as client:
        hits = await maps.search(client, "galax", country="US", timeout=5)

    assert [hit.title for hit in hits] == ["Ennis"]


async def test_search_returns_at_most_max_hits(maps: AppleMaps, http: MockHttp) -> None:
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": [GALAX_HIT] * 15}))
    async with http.client() as client:
        hits = await maps.search(client, "galax", country="US", timeout=5)

    assert MAX_HITS == 10
    assert len(hits) == MAX_HITS


async def test_search_cuts_a_long_name_to_the_stored_length(
    maps: AppleMaps, http: MockHttp
) -> None:
    long_place = _suggestion("x" * 300)
    http.add(SEARCH_URL, httpx2.Response(200, json={"results": [long_place]}))
    async with http.client() as client:
        [hit] = await maps.search(client, "galax", country="US", timeout=5)

    assert hit.name == "x" * LIMITS["recordings"]["place_name"]


async def test_reverse_name_uses_first_result(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        name = await maps.reverse_name(client, 36.6612, -80.9239, accuracy_m=None, timeout=5)

    assert name == "Galax, VA"
    assert _sent(http, REVERSE_URL)[0].url.params["loc"] == "36.6612,-80.9239"


async def test_reverse_name_is_none_without_results(maps: AppleMaps, http: MockHttp) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": []}))
    async with http.client() as client:
        assert await maps.reverse_name(client, 0.0, 0.0, accuracy_m=None, timeout=5) is None


async def test_reverse_name_passes_accuracy_through(maps: AppleMaps, http: MockHttp) -> None:
    street = {
        "name": "1 Main St",
        "countryCode": "US",
        "structuredAddress": {
            "locality": "Galax",
            "administrativeAreaCode": "VA",
            "subLocality": "Downtown",
            "fullThoroughfare": "1 Main St",
        },
    }
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": [street]}))
    async with http.client() as client:
        precise = await maps.reverse_name(client, 36.66, -80.92, accuracy_m=10, timeout=5)
        loose = await maps.reverse_name(client, 36.66, -80.92, accuracy_m=200, timeout=5)
        town = await maps.reverse_name(client, 36.66, -80.92, accuracy_m=900, timeout=5)

    assert (precise, loose, town) == ("1 Main St, Galax, VA", "Downtown, Galax, VA", "Galax, VA")


async def test_busy_maps_raises_with_retry_after(maps: AppleMaps, http: MockHttp) -> None:
    http.add(SEARCH_URL, httpx2.Response(429, headers={"Retry-After": "30"}))
    async with http.client() as client:
        with pytest.raises(MapsBusyError) as caught:
            await maps.search(client, "galax", country="US", timeout=5)

    assert caught.value.retry_after_seconds == 30


async def test_a_failing_maps_raises_maps_error(maps: AppleMaps, http: MockHttp) -> None:
    http.add(SEARCH_URL, httpx2.Response(500))
    async with http.client() as client:
        with pytest.raises(MapsError):
            await maps.search(client, "galax", country="US", timeout=5)


async def test_token_is_still_cached_just_before_the_margin(
    maps: AppleMaps, http: MockHttp, clock: Clock
) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country="US", timeout=5)
        clock.now += 1739
        await maps.search(client, "galax", country="US", timeout=5)

    assert len(_sent(http, TOKEN_URL)) == 1


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"accessToken": "", "expiresInSeconds": 1800},
        {"accessToken": 5, "expiresInSeconds": 1800},
    ],
    ids=["empty", "blank-token", "non-string-token"],
)
async def test_malformed_token_body_raises_maps_error(
    maps: AppleMaps, http: MockHttp, body: dict
) -> None:
    http.add(TOKEN_URL, httpx2.Response(200, json=body))
    async with http.client() as client:
        with pytest.raises(MapsError):
            await maps.search(client, "galax", country="US", timeout=5)


async def test_non_json_lookup_body_raises_maps_error(maps: AppleMaps, http: MockHttp) -> None:
    http.add(SEARCH_URL, httpx2.Response(200, text="<html>"))
    async with http.client() as client:
        with pytest.raises(MapsError):
            await maps.search(client, "galax", country="US", timeout=5)


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ({}, 60),
        ({"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}, 60),
        ({"Retry-After": "nan"}, 60),
        ({"Retry-After": "inf"}, 60),
        ({"Retry-After": "-5"}, 0),
    ],
    ids=["absent", "http-date", "nan", "inf", "negative"],
)
async def test_busy_maps_falls_back_to_the_default_delay(
    maps: AppleMaps, http: MockHttp, headers: dict[str, str], expected: float
) -> None:
    http.add(SEARCH_URL, httpx2.Response(429, headers=headers))
    async with http.client() as client:
        with pytest.raises(MapsBusyError) as caught:
            await maps.search(client, "galax", country="US", timeout=5)

    assert caught.value.retry_after_seconds == expected


async def test_busy_token_exchange_raises_with_retry_after(maps: AppleMaps, http: MockHttp) -> None:
    http.add(TOKEN_URL, httpx2.Response(429, headers={"Retry-After": "12"}))
    async with http.client() as client:
        with pytest.raises(MapsBusyError) as caught:
            await maps.search(client, "galax", country="US", timeout=5)

    assert caught.value.retry_after_seconds == 12


async def test_a_rejected_token_is_dropped(maps: AppleMaps, http: MockHttp) -> None:
    async with http.client() as client:
        await maps.search(client, "galax", country="US", timeout=5)
        http.add(SEARCH_URL, httpx2.Response(401))
        with pytest.raises(MapsError):
            await maps.search(client, "galax", country="US", timeout=5)
        http.add(SEARCH_URL, httpx2.Response(200, json={"results": [GALAX_HIT]}))
        hits = await maps.search(client, "galax", country="US", timeout=5)

    assert len(_sent(http, TOKEN_URL)) == 2
    assert hits == [PlaceHit("Galax, VA", 36.6612, -80.9239, title="Galax, VA", kind="town")]


@pytest.mark.parametrize(
    ("status", "transient"),
    [
        (500, True),
        (503, True),
        (429, True),
        (408, True),
        (401, True),
        (400, False),
        (403, False),
        (404, False),
    ],
)
async def test_a_lookup_failure_says_whether_a_retry_could_help(
    maps: AppleMaps, http: MockHttp, status: int, *, transient: bool
) -> None:
    http.add(REVERSE_URL, httpx2.Response(status))
    async with http.client() as client:
        with pytest.raises(MapsError) as caught:
            await maps.reverse_name(client, 36.66, -80.92, accuracy_m=None, timeout=5)

    assert caught.value.transient is transient


async def test_an_unreadable_answer_is_permanent(maps: AppleMaps, http: MockHttp) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, text="<html>"))
    async with http.client() as client:
        with pytest.raises(MapsError) as caught:
            await maps.reverse_name(client, 36.66, -80.92, accuracy_m=None, timeout=5)

    assert caught.value.transient is False


async def test_a_missing_access_token_is_permanent(maps: AppleMaps, http: MockHttp) -> None:
    http.add(TOKEN_URL, httpx2.Response(200, json={}))
    async with http.client() as client:
        with pytest.raises(MapsError) as caught:
            await maps.reverse_name(client, 36.66, -80.92, accuracy_m=None, timeout=5)

    assert caught.value.transient is False


async def test_a_network_failure_is_transient(maps: AppleMaps) -> None:
    def refuse(request: httpx2.Request) -> httpx2.Response:
        msg = "refused"
        raise httpx2.ConnectError(msg, request=request)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(refuse)) as client:
        with pytest.raises(MapsError) as caught:
            await maps.reverse_name(client, 36.66, -80.92, accuracy_m=None, timeout=5)

    assert caught.value.transient is True


def test_a_signing_failure_is_permanent(maps: AppleMaps, monkeypatch: pytest.MonkeyPatch) -> None:
    def broken(*_args, **_kwargs) -> str:
        raise ValueError

    monkeypatch.setattr("crosstune.places.maps.jwt.encode", broken)
    with pytest.raises(MapsError) as caught:
        maps._sign()

    assert caught.value.transient is False
