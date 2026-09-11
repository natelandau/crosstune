"""Token verification and the current_user dependency."""

import asyncio
import time
import types

import httpx2
import pytest

from crosstune.auth import jwks as jwks_module
from crosstune.auth.jwks import JwksCache

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
