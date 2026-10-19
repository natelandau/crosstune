"""An Apple build below the floor gets 426, and every signed-in request records its version."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING, Self

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError

from crosstune.config import Settings
from crosstune.errors import UPDATE_REQUIRED_PROBLEM
from crosstune.main import create_app
from crosstune.models import ClientVersionSighting, User

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


@pytest.fixture
def settings(database_url: str) -> Settings:
    return Settings(database_url=database_url, apple_min_version="1.2.4")


def _client(platform: str, version: str) -> dict[str, str]:
    return {"X-Client-Platform": platform, "X-Client-Version": version}


BLOCKED = _client("ios", "1.2.3")


async def _sightings(session: AsyncSession) -> list[tuple[str, str]]:
    session.expire_all()
    result = await session.execute(
        select(ClientVersionSighting.platform, ClientVersionSighting.version).order_by(
            ClientVersionSighting.platform
        )
    )
    return [tuple(row) for row in result]


async def _provision(client, auth_headers, clerk_user_id: str) -> None:
    """Create the account with a request that names no client, so nothing is recorded yet."""
    response = await client.get("/v1/me", headers=auth_headers(clerk_user_id))
    assert response.status_code == 200, response.text


async def test_blocked_apple_build_gets_426(client, auth_headers) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | BLOCKED)
    assert r.status_code == 426
    assert r.headers["content-type"].startswith("application/problem+json")
    body = r.json()
    assert body["type"] == UPDATE_REQUIRED_PROBLEM == "urn:crosstune:update-required"
    assert body["title"] == "Update required"
    assert body["status"] == 426
    assert body["detail"] == (
        "This version of Crosstune is no longer supported. Update the app to keep syncing."
    )


async def test_floor_version_passes(client, auth_headers) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("macos", "1.2.4"))
    assert r.status_code == 200, r.text


async def test_web_below_the_apple_floor_passes(client, auth_headers) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("web", "0.1.0"))
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "headers", [{"X-Client-Version": "1.2.3"}, {"X-Client-Platform": "ios"}, {}]
)
async def test_no_platform_or_no_version_passes(client, auth_headers, headers) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | headers)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize(
    "version", ["1." + "9" * 40, "1." + "9" * 5000], ids=["too-long", "past-int-limit"]
)
async def test_an_oversized_version_is_ignored(
    client, auth_headers, verify_session: AsyncSession, version: str
) -> None:
    await _provision(client, auth_headers, "u1")
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("ios", version))
    assert r.status_code == 200, r.text
    assert await _sightings(verify_session) == []


async def test_no_floor_blocks_nothing(client, app, auth_headers) -> None:
    app.state.settings = app.state.settings.model_copy(update={"apple_min_version": ""})
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("ios", "0.0.1"))
    assert r.status_code == 200, r.text


async def test_blocked_with_an_invalid_token_still_gets_426(
    client, verify_session: AsyncSession
) -> None:
    r = await client.get("/v1/me", headers={"Authorization": "Bearer nope"} | BLOCKED)
    assert r.status_code == 426
    assert await _sightings(verify_session) == []


async def test_blocked_without_a_token_still_gets_426(client) -> None:
    r = await client.get("/v1/me", headers=BLOCKED)
    assert r.status_code == 426


async def test_blocked_push_with_a_body_gets_426(client, app, auth_headers) -> None:
    # Over the body cap too: the gate answers before the body is admitted or read.
    app.state.settings.max_request_body_bytes = 10
    r = await client.post(
        "/v1/sync/push",
        content=b'{"changes": []}',
        headers={"Content-Type": "application/json"} | auth_headers("u1") | BLOCKED,
    )
    assert r.status_code == 426
    assert r.json()["type"] == UPDATE_REQUIRED_PROBLEM


async def test_blocked_request_records_the_version(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    await _provision(client, auth_headers, "u1")
    r = await client.get("/v1/me", headers=auth_headers("u1") | BLOCKED)
    assert r.status_code == 426
    assert await _sightings(verify_session) == [("ios", "1.2.3")]


async def test_blocked_gets_426_when_the_account_lookup_fails(
    client, app, auth_headers, verify_session: AsyncSession
) -> None:
    await _provision(client, auth_headers, "u1")

    class FailingSession:
        async def __aenter__(self) -> Self:
            return self

        async def __aexit__(self, *exc_info: object) -> None:
            return None

        async def scalar(self, *args: object, **kwargs: object) -> None:
            raise SQLAlchemyError

    app.state.sessionmaker = FailingSession
    r = await client.get("/v1/me", headers=auth_headers("u1") | BLOCKED)
    assert r.status_code == 426
    assert r.json()["type"] == UPDATE_REQUIRED_PROBLEM
    assert await _sightings(verify_session) == []


async def test_blocked_unknown_user_is_not_provisioned(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | BLOCKED)
    assert r.status_code == 426
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0


async def test_accepted_request_records_the_version(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    await _provision(client, auth_headers, "u1")
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("ios", "1.3.0"))
    assert r.status_code == 200, r.text
    assert await _sightings(verify_session) == [("ios", "1.3.0")]


async def test_the_request_that_creates_the_account_records_the_version(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    r = await client.get("/v1/me", headers=auth_headers("u1") | _client("ios", "1.3.0"))
    assert r.status_code == 200, r.text
    assert await _sightings(verify_session) == [("ios", "1.3.0")]


async def test_failed_route_still_records(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    await _provision(client, auth_headers, "u1")
    r = await client.get(
        f"/v1/recordings/{uuid.uuid4()}/download",
        headers=auth_headers("u1") | _client("macos", "2.0"),
    )
    assert r.status_code == 404
    assert await _sightings(verify_session) == [("macos", "2.0")]


async def test_webhooks_and_healthz_are_never_gated(client) -> None:
    webhook = await client.post("/v1/webhooks/clerk", content=b"{}", headers=BLOCKED)
    # Unsigned, so the webhook itself refuses it.
    assert webhook.status_code == 401
    health = await client.get("/healthz", headers=BLOCKED)
    assert health.status_code == 200


def test_openapi_names_the_update_required_problem() -> None:
    schema = create_app().openapi()["components"]["schemas"]["Problem"]
    assert UPDATE_REQUIRED_PROBLEM in schema["properties"]["type"]["description"]
