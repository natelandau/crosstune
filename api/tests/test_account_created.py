"""The X-Account-Created header marks the one request that created an account."""

import asyncio

import pytest

from crosstune.models import PendingComp
from tests.helpers import uid

pytestmark = pytest.mark.anyio

HEADER = "X-Account-Created"


async def test_first_request_of_a_new_user_says_trial(client, auth_headers) -> None:
    response = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 200
    assert response.headers[HEADER] == "trial"


async def test_later_requests_carry_no_header(client, auth_headers) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    response = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 200
    assert HEADER not in response.headers


async def test_a_claimed_pending_comp_says_comp(client, make_token, verify_session) -> None:
    verify_session.add(PendingComp(email="friend@example.com"))
    await verify_session.commit()
    headers = {"Authorization": f"Bearer {make_token('user_a', email='Friend@Example.com')}"}

    response = await client.get("/v1/me", headers=headers)

    assert response.status_code == 200
    assert response.headers[HEADER] == "comp"


async def test_concurrent_first_requests_mark_exactly_one(client, auth_headers) -> None:
    responses = await asyncio.gather(
        *(client.get("/v1/me", headers=auth_headers("user_a")) for _ in range(4))
    )
    assert [r.status_code for r in responses] == [200] * 4
    assert sum(HEADER in r.headers for r in responses) == 1


async def test_an_unauthenticated_request_carries_no_header(client) -> None:
    response = await client.get("/healthz")
    assert HEADER not in response.headers


async def test_a_failed_first_request_carries_no_header(client, auth_headers, object_store) -> None:
    missing = await client.get(f"/v1/recordings/{uid()}/download", headers=auth_headers("user_a"))
    assert missing.status_code == 404
    assert HEADER not in missing.headers

    response = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert response.headers[HEADER] == "trial"
