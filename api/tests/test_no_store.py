"""Every API response, errors included, tells caches never to store it."""

from __future__ import annotations

import pytest

from tests.helpers import uid, unhandled_error_response

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize(
    ("call", "signed_in", "status"),
    [
        (("GET", "/v1/sync/pull?since=0", None), True, 200),
        (("GET", "/v1/me", None), True, 200),
        (("GET", f"/v1/recordings/{uid()}/download", None), True, 404),
        # Refused by middleware before any route runs.
        (("POST", "/v1/sync/push", b"{}"), False, 401),
    ],
)
async def test_api_responses_are_never_stored(
    client, auth_headers, object_store, call, *, signed_in, status
) -> None:
    method, path, body = call
    headers = auth_headers("user_a") if signed_in else {}
    response = await client.request(method, path, headers=headers, content=body)
    assert response.status_code == status
    assert "no-store" in response.headers["cache-control"]


async def test_an_unhandled_exception_is_never_stored() -> None:
    response = await unhandled_error_response("/v1/__boom__")
    assert response.status_code == 500
    assert "no-store" in response.headers["cache-control"]
