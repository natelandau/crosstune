"""Unhandled exceptions still render as problem details, never a bare traceback."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.config import Settings
from crosstune.errors import PROBLEM_JSON
from crosstune.main import create_app

pytestmark = pytest.mark.anyio


async def test_unhandled_exception_renders_as_problem_details() -> None:
    # debug=False so ServerErrorMiddleware uses the registered handler instead
    # of the debug traceback page.
    app = create_app(Settings(debug=False))

    @app.get("/__boom__")
    async def boom() -> None:
        msg = "kaboom"
        raise RuntimeError(msg)

    transport = httpx2.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx2.AsyncClient(transport=transport, base_url="http://testclient") as client:
        response = await client.get("/__boom__")

    assert response.status_code == 500
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json() == {
        "type": "about:blank",
        "title": "Internal Server Error",
        "status": 500,
        "detail": "An unexpected error occurred",
    }


async def test_unknown_route_is_a_problem_details_404(client) -> None:
    response = await client.get("/v1/nope")
    assert response.status_code == 404
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json()["title"] == "Not Found"


async def test_wrong_method_is_a_problem_details_405(client) -> None:
    response = await client.delete("/v1/me")
    assert response.status_code == 405
    assert response.headers["content-type"] == PROBLEM_JSON
    assert response.json()["title"] == "Method Not Allowed"
    assert "Allow" in response.headers


async def test_validation_failure_has_a_string_detail_and_errors_member(
    client, auth_headers
) -> None:
    response = await client.post(
        "/v1/sync/push", json={"changes": "nope"}, headers=auth_headers("user_a")
    )
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_JSON
    body = response.json()
    assert body["detail"] == "Request validation failed"
    assert body["errors"][0]["loc"] == ["body", "changes"]
