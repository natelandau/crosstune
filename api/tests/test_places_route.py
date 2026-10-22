"""GET /v1/places/search names places for the web client's place picker."""

from __future__ import annotations

import base64
import json
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from urllib.parse import parse_qsl, urlsplit

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from sqlalchemy import update

from crosstune.models.user import User
from crosstune.places.maps import MAPS_URL, AppleMaps

if TYPE_CHECKING:
    from fastapi import FastAPI

    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

URL = "/v1/places/search"
TOKEN_URL = f"{MAPS_URL}/v1/token"
SEARCH_URL = f"{MAPS_URL}/v1/searchAutocomplete"
GALAX = {
    "displayLines": ["Galax, VA", "United States"],
    "location": {"latitude": 36.66123456, "longitude": -80.92391234},
}


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
def maps(app: FastAPI, mock_http: MockHttp) -> AppleMaps:
    maps = AppleMaps(team_id="TEAM123456", key_id="KEY1234567", private_key=_pem())
    app.state.maps = maps
    mock_http.add(
        TOKEN_URL,
        httpx2.Response(200, json={"accessToken": "maps-access", "expiresInSeconds": 1800}),
    )
    mock_http.add(SEARCH_URL, httpx2.Response(200, json={"results": [GALAX]}))
    return maps


@pytest.mark.usefixtures("maps")
async def test_search_returns_places(client, auth_headers) -> None:
    response = await client.get(URL, params={"q": "galax"}, headers=auth_headers("user_123"))

    assert response.status_code == 200
    assert response.json() == {
        "results": [
            {
                "name": "Galax, VA",
                "lat": 36.66123456,
                "lon": -80.92391234,
                "title": "Galax, VA",
                "subtitle": "United States",
                "kind": "town",
                "address": None,
            }
        ]
    }


@pytest.mark.usefixtures("maps")
async def test_search_returns_a_venue_as_picked(client, auth_headers, mock_http) -> None:
    venue = {
        **GALAX,
        "displayLines": ["Rex Theater", "113 E Grayson St, Galax, VA  24333, United States"],
    }
    mock_http.add(SEARCH_URL, httpx2.Response(200, json={"results": [venue]}))

    response = await client.get(URL, params={"q": "rex"}, headers=auth_headers("user_123"))

    [result] = response.json()["results"]
    assert result["name"] == "Rex Theater, 113 E Grayson St, Galax, VA"
    assert result["title"] == "Rex Theater"
    assert result["subtitle"] == "113 E Grayson St, Galax, VA, United States"
    assert result["kind"] == "venue"
    assert result["address"] == "113 E Grayson St, Galax, VA"


@pytest.mark.usefixtures("maps")
async def test_search_returns_a_street_address_with_no_address_line(
    client, auth_headers, mock_http
) -> None:
    street = {**GALAX, "displayLines": ["113 E Grayson St", "Galax, VA  24333, United States"]}
    mock_http.add(SEARCH_URL, httpx2.Response(200, json={"results": [street]}))

    response = await client.get(URL, params={"q": "113 e"}, headers=auth_headers("user_123"))

    [result] = response.json()["results"]
    assert result["name"] == "113 E Grayson St, Galax, VA"
    assert result["kind"] == "address"
    assert result["address"] is None


@pytest.mark.usefixtures("maps")
async def test_search_leans_toward_the_account_country(
    client, auth_headers, mock_http, verify_session
) -> None:
    headers = auth_headers("user_123")
    first = await client.get(URL, params={"q": "galax"}, headers=headers)
    await verify_session.execute(
        update(User).where(User.clerk_user_id == "user_123").values(country="US")
    )
    await verify_session.commit()

    second = await client.get(URL, params={"q": "galax"}, headers=headers)

    searches = [call for call in mock_http.calls if str(call.url).startswith(SEARCH_URL)]
    assert "searchLocation" not in searches[0].url.params
    assert searches[1].url.params["searchLocation"] == "39.54,-97.48"
    assert "limitToCountries" not in searches[1].url.params
    assert first.json()["results"][0]["subtitle"] == "United States"
    assert second.json()["results"][0] == {
        "name": "Galax, VA",
        "lat": 36.66123456,
        "lon": -80.92391234,
        "title": "Galax, VA",
        "subtitle": None,
        "kind": "town",
        "address": None,
    }


async def test_search_needs_sign_in(client) -> None:
    response = await client.get(URL, params={"q": "galax"})

    assert response.status_code == 401


async def test_search_without_maps_is_unavailable(app, client, auth_headers) -> None:
    app.state.maps = None

    response = await client.get(URL, params={"q": "galax"}, headers=auth_headers("user_123"))

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"


@pytest.mark.usefixtures("maps")
async def test_search_rate_limit(app, client, auth_headers) -> None:
    headers = auth_headers("user_123")
    limit = app.state.settings.place_searches_per_minute

    codes = [
        (await client.get(URL, params={"q": "galax"}, headers=headers)).status_code
        for _ in range(limit)
    ]
    refused = await client.get(URL, params={"q": "galax"}, headers=headers)

    assert codes == [200] * limit
    assert refused.status_code == 429
    assert refused.headers["content-type"] == "application/problem+json"
    assert 0 < int(refused.headers["retry-after"]) <= 60


@pytest.mark.usefixtures("maps")
async def test_busy_maps_answers_429_with_its_retry_after(client, auth_headers, mock_http) -> None:
    mock_http.add(SEARCH_URL, httpx2.Response(429, headers={"Retry-After": "17"}))

    response = await client.get(URL, params={"q": "galax"}, headers=auth_headers("user_123"))

    assert response.status_code == 429
    assert response.headers["retry-after"] == "17"


@pytest.mark.usefixtures("maps")
async def test_failing_maps_is_unavailable(client, auth_headers, mock_http) -> None:
    mock_http.add(SEARCH_URL, httpx2.Response(500))

    response = await client.get(URL, params={"q": "galax"}, headers=auth_headers("user_123"))

    assert response.status_code == 503


@pytest.mark.usefixtures("maps")
@pytest.mark.parametrize("q", ["g", "x" * 101])
async def test_search_refuses_a_query_outside_the_length_bounds(client, auth_headers, q) -> None:
    response = await client.get(URL, params={"q": q}, headers=auth_headers("user_123"))

    assert response.status_code == 422


# --- map tokens and snapshots ---

TOKEN_ROUTE = "/v1/places/mapkit-token"
SNAPSHOT_ROUTE = "/v1/places/snapshot"
SNAPSHOT_PARAMS = {
    "lat": 36.661234,
    "lon": -80.923912,
    "width": 120,
    "height": 90,
    "scheme": "dark",
}
SNAPSHOT_HOST = "https://snapshot.apple-mapkit.com"


def _keyed_maps(app: FastAPI, clock=None) -> AppleMaps:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    maps = AppleMaps(
        team_id="TEAM123456",
        key_id="KEY1234567",
        private_key=pem,
        **({"clock": clock} if clock else {}),
    )
    maps.test_public_key = key.public_key()  # type: ignore[attr-defined]
    app.state.maps = maps
    return maps


async def test_mapkit_token_claims_and_expiry(app, client, auth_headers, settings) -> None:
    maps = _keyed_maps(app, clock=lambda: 1_800_000_000.0)

    response = await client.get(TOKEN_ROUTE, headers=auth_headers("user_123"))

    assert response.status_code == 200
    body = response.json()
    claims = jwt.decode(
        body["token"],
        maps.test_public_key,
        algorithms=["ES256"],
        options={"verify_exp": False, "verify_iat": False},
    )
    assert jwt.get_unverified_header(body["token"])["kid"] == "KEY1234567"
    assert claims == {
        "iss": "TEAM123456",
        "iat": 1_800_000_000 - 5,
        "exp": 1_800_000_000 + 1800,
        "scope": "mapkit_js",
        "origin": settings.web_origin,
    }
    assert datetime.fromisoformat(body["expires_at"]) == datetime.fromtimestamp(
        1_800_001_800, tz=UTC
    )


async def test_mapkit_token_needs_sign_in(app, client) -> None:
    _keyed_maps(app)

    response = await client.get(TOKEN_ROUTE)

    assert response.status_code == 401


async def test_mapkit_token_503_without_maps_key(app, client, auth_headers) -> None:
    app.state.maps = None

    response = await client.get(TOKEN_ROUTE, headers=auth_headers("user_123"))

    assert response.status_code == 503


async def _snapshot(client, auth_headers, **override) -> str:
    response = await client.get(
        SNAPSHOT_ROUTE, params={**SNAPSHOT_PARAMS, **override}, headers=auth_headers("user_123")
    )
    assert response.status_code == 200
    return response.json()["url"]


async def test_snapshot_url_is_signed_with_signature_last(app, client, auth_headers) -> None:
    maps = _keyed_maps(app)

    url = await _snapshot(client, auth_headers)

    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{SNAPSHOT_HOST}/api/v1/snapshot"
    query = dict(parse_qsl(parts.query))
    assert query["teamId"] == "TEAM123456"
    assert query["keyId"] == "KEY1234567"
    assert query["size"] == "120x90"
    assert query["colorScheme"] == "dark"
    signed, _, signature = url.removeprefix(SNAPSHOT_HOST).rpartition("&signature=")
    assert "&" not in signature
    assert "=" not in signature
    raw = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
    assert len(raw) == 64
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    maps.test_public_key.verify(der, signed.encode(), ec.ECDSA(hashes.SHA256()))  # type: ignore[attr-defined]


async def test_snapshot_rounds_coordinates(app, client, auth_headers) -> None:
    _keyed_maps(app)

    url = await _snapshot(client, auth_headers)

    query = dict(parse_qsl(urlsplit(url).query))
    [pin] = json.loads(query["annotations"])
    assert pin["point"] == "36.6612,-80.9239"
    assert "overlays" not in query


async def test_snapshot_draws_a_circle_for_a_loose_fix(app, client, auth_headers) -> None:
    _keyed_maps(app)

    url = await _snapshot(client, auth_headers, accuracy_m=400)

    query = dict(parse_qsl(urlsplit(url).query))
    [circle] = json.loads(query["overlays"])
    assert circle["type"] == "circle"
    assert circle["center"] == "36.6612,-80.9239"
    assert circle["radius"] == 400
    assert "annotations" not in query


@pytest.mark.parametrize(
    "override",
    [{"width": 49}, {"width": 641}, {"height": 49}, {"height": 641}, {"scheme": "sepia"}],
)
async def test_snapshot_rejects_sizes_out_of_range(app, client, auth_headers, override) -> None:
    _keyed_maps(app)

    response = await client.get(
        SNAPSHOT_ROUTE, params={**SNAPSHOT_PARAMS, **override}, headers=auth_headers("user_123")
    )

    assert response.status_code == 422


async def test_snapshot_keeps_rounded_coordinates_inside_apples_open_ranges(
    app, client, auth_headers
) -> None:
    _keyed_maps(app)

    url = await _snapshot(client, auth_headers, lat=89.99996, lon=-179.99996)

    [pin] = json.loads(dict(parse_qsl(urlsplit(url).query))["annotations"])
    assert pin["point"] == "89.9999,-179.9999"


@pytest.mark.parametrize("override", [{"lat": 90}, {"lat": -90}, {"lon": 180}, {"lon": -180}])
async def test_snapshot_rejects_the_poles_and_antimeridian(
    app, client, auth_headers, override
) -> None:
    _keyed_maps(app)

    response = await client.get(
        SNAPSHOT_ROUTE, params={**SNAPSHOT_PARAMS, **override}, headers=auth_headers("user_123")
    )

    assert response.status_code == 422
