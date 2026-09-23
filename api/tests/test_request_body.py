"""No request body is read before its caller is known, and none past the size limit."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from crosstune.body import WEBHOOK_MAX_BODY_BYTES

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

pytestmark = pytest.mark.anyio


async def _chunks(total: int, size: int = 1024) -> AsyncIterator[bytes]:
    sent = 0
    while sent < total:
        yield b" " * min(size, total - sent)
        sent += size


async def test_a_body_without_a_token_is_refused_before_it_is_read(client) -> None:
    response = await client.post(
        "/v1/sync/push", content=b"{not json", headers={"Content-Type": "application/json"}
    )
    assert response.status_code == 401
    assert response.headers["content-type"] == "application/problem+json"


async def test_a_body_with_an_invalid_token_is_refused_before_it_is_read(client) -> None:
    response = await client.post(
        "/v1/sync/push",
        content=b"{not json",
        headers={"Content-Type": "application/json", "Authorization": "Bearer nope"},
    )
    assert response.status_code == 401


async def test_a_declared_body_over_the_limit_is_refused(client, app, auth_headers) -> None:
    app.state.settings.max_request_body_bytes = 1000
    response = await client.post(
        "/v1/sync/push",
        content=b" " * 1001,
        headers={"Content-Type": "application/json", **auth_headers("user_a")},
    )
    assert response.status_code == 413
    assert response.headers["content-type"] == "application/problem+json"


async def test_a_streamed_body_over_the_limit_is_refused(client, app, auth_headers) -> None:
    app.state.settings.max_request_body_bytes = 1000
    response = await client.post(
        "/v1/sync/push",
        content=_chunks(5000),
        headers={"Content-Type": "application/json", **auth_headers("user_a")},
    )
    assert response.status_code == 413


async def test_a_body_at_the_limit_is_accepted(client, app, auth_headers) -> None:
    body = b'{"changes": []}'
    app.state.settings.max_request_body_bytes = len(body)
    response = await client.post(
        "/v1/sync/push",
        content=body,
        headers={"Content-Type": "application/json", **auth_headers("user_a")},
    )
    assert response.status_code == 200, response.text


async def test_the_webhook_refuses_a_body_over_its_own_limit(client) -> None:
    response = await client.post("/v1/webhooks/clerk", content=_chunks(WEBHOOK_MAX_BODY_BYTES + 1))
    assert response.status_code == 413
