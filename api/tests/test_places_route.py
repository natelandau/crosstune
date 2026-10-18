"""GET /v1/places/search names places for the web client's place picker."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx2
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
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
