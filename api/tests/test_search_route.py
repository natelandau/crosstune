"""GET /v1/links/search fans out to the chosen services and degrades per service."""

from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

import httpx2
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from pydantic import SecretStr

from crosstune.links.search.backoff import Backoff
from crosstune.links.search.registry import SearchTokens, adapters
from crosstune.links.search.tokens import TIDAL_TOKEN_URL
from crosstune.links.search.types import AdapterAnswer, SearchHit
from crosstune.ratelimit import RateLimiter
from crosstune.vocabulary import Provider

if TYPE_CHECKING:
    from fastapi import FastAPI

    from crosstune.config import Settings
    from crosstune.links.search.types import Adapter
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

FIXTURES = Path(__file__).parent / "fixtures" / "search"
APPLE_SEARCH = "https://api.music.apple.com/v1/catalog/"
TIDAL_SEARCH = "https://openapi.tidal.com/v2/searchResults"
ARCHIVE_SEARCH = "https://archive.org/advancedsearch.php"
URL = "/v1/links/search"


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


def _params(*providers: str, q: str = "silver spear", **extra: str) -> list[tuple[str, str]]:
    return [("q", q), *[("providers", p) for p in providers], *extra.items()]


def _fixture(name: str) -> dict:
    return json.loads((FIXTURES / f"{name}.json").read_text())


@pytest.fixture
def credentialed(app: FastAPI, settings: Settings, mock_http: MockHttp) -> SearchTokens:
    """Give the app Apple Music and TIDAL credentials, so both have adapters."""
    configured = settings.model_copy(
        update={
            "apple_music_team_id": "TEAM123456",
            "apple_music_key_id": "KEY1234567",
            "apple_music_private_key": SecretStr(_pem()),
            "tidal_client_id": "id",
            "tidal_client_secret": SecretStr("secret"),
        }
    )
    tokens = SearchTokens.from_settings(configured)
    app.state.search_tokens = tokens
    app.state.search_adapters = adapters(configured, tokens, app.state.search_backoff)
    mock_http.add(
        TIDAL_TOKEN_URL,
        httpx2.Response(200, json={"access_token": "tidal-access", "expires_in": 86_400}),
    )
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=_fixture("internet_archive")))
    return tokens


def _outbound(mock_http: MockHttp) -> list[httpx2.Request]:
    return [c for c in mock_http.calls if "clerk" not in str(c.url)]


async def test_groups_follow_the_fixed_order(client, auth_headers, mock_http) -> None:
    mock_http.add(ARCHIVE_SEARCH, httpx2.Response(200, json=_fixture("internet_archive")))
    response = await client.get(
        URL,
        params=_params("spotify", "internet_archive", "apple_music"),
        headers=auth_headers("user_123"),
    )

    assert response.status_code == 200
    assert [g["provider"] for g in response.json()["groups"]] == [
        "apple_music",
        "internet_archive",
        "spotify",
    ]


async def test_mixed_statuses_in_one_response(
    client, auth_headers, mock_http, credentialed
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=_fixture("apple_music")))
    mock_http.add(TIDAL_SEARCH, httpx2.Response(500))
    response = await client.get(
        URL, params=_params("apple_music", "tidal", "spotify"), headers=auth_headers("user_123")
    )

    groups = response.json()["groups"]
    assert [(g["provider"], g["status"]) for g in groups] == [
        ("apple_music", "results"),
        ("tidal", "unavailable"),
        ("spotify", "search_only"),
    ]
    assert groups[0]["results"]
    assert groups[1]["results"] == groups[2]["results"] == []
    assert all(g["search_url"] for g in groups)


async def test_search_url_uses_the_country_that_answered(
    client, auth_headers, mock_http, credentialed
) -> None:
    mock_http.add(f"{APPLE_SEARCH}xx/", httpx2.Response(404))
    mock_http.add(f"{APPLE_SEARCH}us/", httpx2.Response(200, json=_fixture("apple_music")))
    response = await client.get(
        URL, params=_params("apple_music", country="XX"), headers=auth_headers("user_123")
    )

    [group] = response.json()["groups"]
    assert group["status"] == "results"
    assert "/us/search" in group["search_url"]


async def test_unconfigured_service_is_search_only(client, auth_headers, mock_http) -> None:
    response = await client.get(
        URL, params=_params("apple_music"), headers=auth_headers("user_123")
    )

    [group] = response.json()["groups"]
    assert group["status"] == "search_only"
    assert group["search_url"].startswith("https://music.apple.com/us/search?term=")
    assert _outbound(mock_http) == []


async def test_only_search_only_services_makes_no_outbound_call(
    client, auth_headers, mock_http
) -> None:
    response = await client.get(
        URL,
        params=_params("youtube", "spotify", "bandcamp", "soundcloud"),
        headers=auth_headers("user_123"),
    )

    assert {g["status"] for g in response.json()["groups"]} == {"search_only"}
    assert _outbound(mock_http) == []


async def test_auth_failure_invalidates_the_token(
    client, auth_headers, mock_http, credentialed, monkeypatch
) -> None:
    invalidated: list[str] = []
    token = credentialed.apple_music
    assert token is not None
    real = token.invalidate

    def spy() -> None:
        invalidated.append("apple_music")
        real()

    monkeypatch.setattr(token, "invalidate", spy)
    mock_http.add(APPLE_SEARCH, httpx2.Response(401))
    response = await client.get(
        URL, params=_params("apple_music"), headers=auth_headers("user_123")
    )

    [group] = response.json()["groups"]
    assert group["status"] == "unavailable"
    # The adapter drops the refused token itself; the service must not drop it a second time.
    assert invalidated == ["apple_music"]


async def test_slow_service_times_out_alone(app, client, auth_headers, settings: Settings) -> None:
    async def slow(*_args: object) -> AdapterAnswer:
        await asyncio.sleep(5)
        return AdapterAnswer([], "US")

    async def quick(*_args: object) -> AdapterAnswer:
        hit = SearchHit("https://archive.org/details/x", "internet_archive", "x", "X", None, None)
        return AdapterAnswer([hit], "US")

    app.state.settings = settings.model_copy(update={"link_resolve_timeout_seconds": 0.05})
    app.state.search_adapters = {Provider.APPLE_MUSIC: slow, Provider.INTERNET_ARCHIVE: quick}
    response = await client.get(
        URL,
        params=_params("apple_music", "internet_archive"),
        headers=auth_headers("user_123"),
    )

    assert [(g["provider"], g["status"]) for g in response.json()["groups"]] == [
        ("apple_music", "unavailable"),
        ("internet_archive", "results"),
    ]


async def test_services_run_concurrently(app, client, auth_headers) -> None:
    """Each adapter waits for the other to start, which only a concurrent run satisfies."""
    started = {Provider.APPLE_MUSIC: asyncio.Event(), Provider.INTERNET_ARCHIVE: asyncio.Event()}

    def waits_for(own: Provider, other: Provider) -> Adapter:
        async def search(*_args: object) -> AdapterAnswer:
            started[own].set()
            # A sequential run never sets the other event, so the wait fails instead of hanging.
            await asyncio.wait_for(started[other].wait(), timeout=2)
            return AdapterAnswer([], "US")

        return search

    app.state.search_adapters = {
        Provider.APPLE_MUSIC: waits_for(Provider.APPLE_MUSIC, Provider.INTERNET_ARCHIVE),
        Provider.INTERNET_ARCHIVE: waits_for(Provider.INTERNET_ARCHIVE, Provider.APPLE_MUSIC),
    }
    response = await client.get(
        URL,
        params=_params("apple_music", "internet_archive"),
        headers=auth_headers("user_123"),
    )

    assert [g["status"] for g in response.json()["groups"]] == ["results", "results"]


async def test_a_requested_service_twice_is_one_group(client, auth_headers) -> None:
    response = await client.get(
        URL, params=_params("spotify", "spotify"), headers=auth_headers("user_123")
    )

    assert [g["provider"] for g in response.json()["groups"]] == ["spotify"]


async def test_a_raising_adapter_is_unavailable(
    app, client, auth_headers, caplog: pytest.LogCaptureFixture
) -> None:
    async def broken(*_args: object) -> AdapterAnswer:
        msg = "boom"
        raise RuntimeError(msg)

    app.state.search_adapters = {Provider.INTERNET_ARCHIVE: broken}
    with caplog.at_level(logging.WARNING):
        response = await client.get(
            URL, params=_params("internet_archive"), headers=auth_headers("user_123")
        )

    assert response.status_code == 200
    assert response.json()["groups"][0]["status"] == "unavailable"
    [record] = [r for r in caplog.records if r.getMessage() == "music search failed"]
    assert record.levelno == logging.WARNING
    assert record.provider == "internet_archive"


def _search_log(caplog: pytest.LogCaptureFixture) -> logging.LogRecord:
    [record] = [r for r in caplog.records if r.name == "crosstune.links.search.service"]
    return record


async def test_refused_credentials_log_an_error_without_the_token(
    client, auth_headers, mock_http, credentialed, caplog: pytest.LogCaptureFixture
) -> None:
    mock_http.add(APPLE_SEARCH, httpx2.Response(401))
    with caplog.at_level(logging.WARNING):
        response = await client.get(
            URL, params=_params("apple_music"), headers=auth_headers("user_123")
        )

    assert response.json()["groups"][0]["status"] == "unavailable"
    record = _search_log(caplog)
    assert record.levelno == logging.ERROR
    assert record.exc_info is None
    assert record.provider == "apple_music"
    assert "Bearer" not in caplog.text
    assert "Bearer" not in repr(vars(record))


async def test_a_signing_failure_logs_an_error_without_the_key(
    client, auth_headers, credentialed, caplog: pytest.LogCaptureFixture, monkeypatch
) -> None:
    # ES256 cannot sign with an RSA key, so signing fails the way a corrupt key would.
    rsa_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    monkeypatch.setattr(credentialed.apple_music, "_private_key", rsa_key)
    with caplog.at_level(logging.WARNING):
        response = await client.get(
            URL, params=_params("apple_music"), headers=auth_headers("user_123")
        )

    assert response.json()["groups"][0]["status"] == "unavailable"
    record = _search_log(caplog)
    assert record.levelno == logging.ERROR
    assert record.exc_info is None
    assert "PRIVATE KEY" not in caplog.text


async def test_a_timeout_logs_a_warning_with_its_traceback(
    app, client, auth_headers, settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    async def slow(*_args: object) -> AdapterAnswer:
        await asyncio.sleep(5)
        return AdapterAnswer([], "US")

    app.state.settings = settings.model_copy(update={"link_resolve_timeout_seconds": 0.05})
    app.state.search_adapters = {Provider.INTERNET_ARCHIVE: slow}
    with caplog.at_level(logging.WARNING):
        await client.get(URL, params=_params("internet_archive"), headers=auth_headers("user_123"))

    record = _search_log(caplog)
    assert record.levelno == logging.WARNING
    assert record.exc_info is not None


@pytest.mark.parametrize(
    "params",
    [
        _params("spotify", q=""),
        _params("spotify", q="x" * 201),
        _params("other"),
        [("q", "silver spear")],
        _params("spotify", country="USA"),
        _params("spotify", country="U1"),
        _params("nonsense"),
    ],
)
async def test_invalid_requests(client, auth_headers, params) -> None:
    response = await client.get(URL, params=params, headers=auth_headers("user_123"))

    assert response.status_code == 422
    assert response.headers["content-type"] == "application/problem+json"


async def test_country_defaults_to_us(client, auth_headers) -> None:
    response = await client.get(
        URL, params=_params("apple_music"), headers=auth_headers("user_123")
    )

    assert "/us/search" in response.json()["groups"][0]["search_url"]


async def test_country_is_passed_uppercased(app, client, auth_headers) -> None:
    seen: list[str] = []

    async def adapter(_query: str, country: str, *_rest: object) -> AdapterAnswer:
        seen.append(country)
        return AdapterAnswer([], "US")

    app.state.search_adapters = {Provider.INTERNET_ARCHIVE: adapter}
    await client.get(
        URL,
        params=_params("internet_archive", country="ie"),
        headers=auth_headers("user_123"),
    )

    assert seen == ["IE"]


async def test_search_rate_limit(app, client, auth_headers) -> None:
    resolve_limiter = app.state.link_resolve_limiter
    headers = auth_headers("user_123")

    codes = [
        (await client.get(URL, params=_params("spotify"), headers=headers)).status_code
        for _ in range(20)
    ]
    refused = await client.get(URL, params=_params("spotify"), headers=headers)

    assert codes == [200] * 20
    assert refused.status_code == 429
    assert refused.headers["content-type"] == "application/problem+json"
    assert 0 < int(refused.headers["retry-after"]) <= 60
    assert resolve_limiter.tracked == 0
    assert isinstance(app.state.link_search_limiter, RateLimiter)


async def test_invalid_requests_do_not_count_against_the_rate_limit(client, auth_headers) -> None:
    headers = auth_headers("user_123")
    # A first valid search commits the caller's account, so every later request is charged
    # to the same user rather than to an account the 422 rolls back.
    first = await client.get(URL, params=_params("spotify"), headers=headers)

    codes = [
        (await client.get(URL, params=_params("spotify", q=""), headers=headers)).status_code
        for _ in range(25)
    ]
    valid = await client.get(URL, params=_params("spotify"), headers=headers)

    assert first.status_code == 200
    assert codes == [422] * 25
    assert valid.status_code == 200


async def test_requires_sign_in(client) -> None:
    response = await client.get(URL, params=_params("spotify"))

    assert response.status_code == 401


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.mark.parametrize(("retry_after", "held_for"), [("30", 30.0), (None, 60.0)])
async def test_a_rate_limited_service_is_left_alone_until_it_may_be_called(
    app, client, auth_headers, mock_http, credentialed, retry_after, held_for
) -> None:
    clock = _Clock()
    app.state.search_backoff = Backoff(clock=clock)
    headers = {"Retry-After": retry_after} if retry_after else {}
    mock_http.add(TIDAL_SEARCH, httpx2.Response(429, headers=headers))

    async def tidal_status() -> str:
        response = await client.get(URL, params=_params("tidal"), headers=auth_headers("user_123"))
        [group] = response.json()["groups"]
        return group["status"]

    assert await tidal_status() == "unavailable"
    assert len([c for c in _outbound(mock_http) if str(c.url).startswith(TIDAL_SEARCH)]) == 1

    clock.now += held_for - 1
    assert await tidal_status() == "unavailable"
    assert len([c for c in _outbound(mock_http) if str(c.url).startswith(TIDAL_SEARCH)]) == 1

    clock.now += 1
    assert await tidal_status() == "unavailable"
    assert len([c for c in _outbound(mock_http) if str(c.url).startswith(TIDAL_SEARCH)]) == 2


async def test_a_rate_limit_holds_only_that_service(
    app, client, auth_headers, mock_http, credentialed
) -> None:
    app.state.search_backoff = Backoff(clock=_Clock())
    mock_http.add(TIDAL_SEARCH, httpx2.Response(429, headers={"Retry-After": "30"}))
    mock_http.add(APPLE_SEARCH, httpx2.Response(200, json=_fixture("apple_music")))
    await client.get(URL, params=_params("tidal"), headers=auth_headers("user_123"))

    response = await client.get(
        URL, params=_params("apple_music", "tidal"), headers=auth_headers("user_123")
    )

    assert [(g["provider"], g["status"]) for g in response.json()["groups"]] == [
        ("apple_music", "results"),
        ("tidal", "unavailable"),
    ]
