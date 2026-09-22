"""Token verification and the current_user dependency."""

import asyncio
import time
import types

import httpx2
import pytest

from crosstune.auth import jwks as jwks_module
from crosstune.auth.jwks import JwksCache
from crosstune.auth.tokens import party_allowed, verify_clerk_token
from crosstune.db.engine import make_sessionmaker
from crosstune.errors import UnauthorizedError
from crosstune.main import create_app

pytestmark = pytest.mark.anyio


async def test_missing_token_is_401(client: httpx2.AsyncClient) -> None:
    response = await client.get("/v1/me")
    assert response.status_code == 401
    assert response.headers["content-type"].startswith("application/problem+json")
    assert response.json()["title"] == "Unauthorized"


async def test_expired_token_is_401(client: httpx2.AsyncClient, make_token) -> None:
    token = make_token("user_a", exp=int(time.time()) - 60)
    response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_wrong_issuer_is_401(client: httpx2.AsyncClient, make_token) -> None:
    token = make_token("user_a", iss="https://someone-else.clerk.accounts.dev")
    response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_unauthorized_party_is_401(client: httpx2.AsyncClient, make_token) -> None:
    token = make_token("user_a", azp="http://evil.example")
    response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_unknown_kid_is_401(client: httpx2.AsyncClient, make_token) -> None:
    token = make_token("user_a", kid="not-a-real-kid")
    response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401


async def test_valid_token_is_200(client: httpx2.AsyncClient, auth_headers) -> None:
    response = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 200


async def test_first_lookup_refreshes_on_a_freshly_booted_host(
    settings, mock_http, monkeypatch
) -> None:
    # A host whose monotonic clock has barely started must not read as recently fetched.
    monkeypatch.setattr(jwks_module, "time", types.SimpleNamespace(monotonic=lambda: 5.0))
    async with mock_http.client() as http:
        cache = JwksCache(settings.clerk_jwks_url, http)
        assert await cache.get_key("test-kid") is not None


async def test_concurrent_lookups_fetch_the_jwks_once_and_both_see_the_key(
    settings, mock_http
) -> None:
    async def slow(request: httpx2.Request) -> httpx2.Response:
        await asyncio.sleep(0.01)
        return mock_http.handler(request)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(slow)) as http:
        cache = JwksCache(settings.clerk_jwks_url, http)
        keys = await asyncio.gather(cache.get_key("test-kid"), cache.get_key("test-kid"))

    assert all(key is not None for key in keys)
    assert len(mock_http.calls) == 1


PREVIEW_REGEX = r"^https://[a-z0-9-]+-crosstune-web\.example\.workers\.dev$"


def test_party_allowed_rejects_a_non_string_party() -> None:
    assert party_allowed(None, [], PREVIEW_REGEX) is False
    assert party_allowed(42, ["http://testclient"], "") is False


async def test_party_matching_the_regex_is_200(
    settings, engine, mock_http, make_token, truncate_all
) -> None:
    """A token whose azp matches the regex, but is not in the explicit list, is accepted."""
    preview = settings.model_copy(update={"clerk_authorized_party_regex": PREVIEW_REGEX})
    app = create_app(preview)
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.http_client = mock_http.client()
    app.state.jwks = JwksCache(preview.clerk_jwks_url, app.state.http_client)
    token = make_token("user_a", azp="https://feat-x-crosstune-web.example.workers.dev")
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        response = await client.get("/v1/me", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200


async def test_party_matching_neither_list_nor_regex_is_401(
    settings, mock_http, make_token
) -> None:
    """A token whose azp matches neither the list nor the regex is rejected."""
    token = make_token("user_a", azp="https://evil.example")
    async with mock_http.client() as http:
        jwks = JwksCache(settings.clerk_jwks_url, http)
        with pytest.raises(UnauthorizedError, match="not issued for this application"):
            await verify_clerk_token(
                token, jwks, settings.clerk_issuer, settings.clerk_authorized_parties, PREVIEW_REGEX
            )


async def test_an_unreadable_jwks_entry_does_not_hide_the_readable_ones(
    settings, mock_http, jwks_document
) -> None:
    broken = {"kid": "broken", "kty": "RSA", "use": "sig", "alg": "RS256"}
    mock_http.add(
        settings.clerk_jwks_url,
        httpx2.Response(200, json={"keys": [broken, *jwks_document["keys"]]}),
    )
    async with mock_http.client() as http:
        cache = JwksCache(settings.clerk_jwks_url, http)
        assert await cache.get_key("test-kid") is not None
        assert await cache.get_key("broken") is None
