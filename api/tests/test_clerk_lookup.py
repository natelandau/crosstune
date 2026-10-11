"""Looking up a Clerk user by email or ID, which never creates one."""

from __future__ import annotations

from typing import Any

import httpx2
import pytest

from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError, ClerkUser

pytestmark = pytest.mark.anyio

EMAIL = "a+clerk_test@example.com"


def _user(user_id: str = "user_1", email: str = EMAIL) -> dict[str, Any]:
    return {
        "id": user_id,
        "primary_email_address_id": "idn_2",
        "email_addresses": [
            {"id": "idn_1", "email_address": "other@example.com"},
            {"id": "idn_2", "email_address": email},
        ],
    }


async def _find(account: str, handler: Any) -> tuple[ClerkUser | None, list[httpx2.Request]]:
    calls: list[httpx2.Request] = []

    def record(request: httpx2.Request) -> httpx2.Response:
        calls.append(request)
        return handler(request)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(record))
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        return await users.find_user(account), calls
    finally:
        await client.aclose()


async def test_find_user_by_email_returns_id_and_email() -> None:
    found, calls = await _find(EMAIL, lambda _r: httpx2.Response(200, json=[_user()]))

    assert found == ClerkUser("user_1", EMAIL)
    assert [c.method for c in calls] == ["GET"]
    assert calls[0].url.path == "/v1/users"
    assert calls[0].url.params["email_address"] == EMAIL


async def test_find_user_by_email_missing_returns_none() -> None:
    found, calls = await _find(EMAIL, lambda _r: httpx2.Response(200, json=[]))

    assert found is None
    assert [c.method for c in calls] == ["GET"]


async def test_find_user_by_id_returns_user() -> None:
    found, calls = await _find("user_1", lambda _r: httpx2.Response(200, json=_user()))

    assert found == ClerkUser("user_1", EMAIL)
    assert [(c.method, c.url.path) for c in calls] == [("GET", "/v1/users/user_1")]


async def test_find_user_by_id_without_addresses_has_no_email() -> None:
    found, _ = await _find(
        "user_1", lambda _r: httpx2.Response(200, json={"id": "user_1", "email_addresses": []})
    )

    assert found == ClerkUser("user_1", None)


async def test_find_user_by_id_404_returns_none() -> None:
    found, _ = await _find("user_1", lambda _r: httpx2.Response(404))

    assert found is None


async def test_find_user_rejects_other_input() -> None:
    with pytest.raises(ValueError, match="bob is neither a Clerk user ID"):
        await _find("bob", lambda _r: httpx2.Response(200, json=[]))


async def test_find_user_error_raises_clerk_unavailable() -> None:
    with pytest.raises(ClerkUnavailableError):
        await _find(EMAIL, lambda _r: httpx2.Response(500))


@pytest.mark.parametrize("account", ["user_../sessions", "user_", "user_a/b", "user_a?x=1"])
async def test_find_user_rejects_a_malformed_id(account: str) -> None:
    with pytest.raises(ValueError, match="neither a Clerk user ID"):
        await _find(account, lambda _r: httpx2.Response(200, json=_user()))


async def test_find_user_by_email_non_json_raises_clerk_unavailable() -> None:
    with pytest.raises(ClerkUnavailableError, match="not JSON"):
        await _find(EMAIL, lambda _r: httpx2.Response(200, content=b"<html>"))


async def test_find_user_by_email_non_list_raises_clerk_unavailable() -> None:
    with pytest.raises(ClerkUnavailableError, match="user list"):
        await _find(EMAIL, lambda _r: httpx2.Response(200, json={"data": []}))
