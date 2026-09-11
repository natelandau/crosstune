"""User provisioning."""

import httpx2
import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.models import User

pytestmark = pytest.mark.anyio


async def test_me_creates_user_on_first_call(client: httpx2.AsyncClient, auth_headers) -> None:
    response = await client.get("/v1/me", headers=auth_headers("user_new"))
    assert response.status_code == 200
    body = response.json()
    assert body["clerk_user_id"] == "user_new"
    assert body["id"]


async def test_me_is_idempotent(
    client: httpx2.AsyncClient, auth_headers, verify_session: AsyncSession
) -> None:
    first = await client.get("/v1/me", headers=auth_headers("user_twice"))
    second = await client.get("/v1/me", headers=auth_headers("user_twice"))
    assert first.json()["id"] == second.json()["id"]
    count = await verify_session.scalar(
        select(func.count()).select_from(User).where(User.clerk_user_id == "user_twice")
    )
    assert count == 1


async def test_email_claim_is_recorded_and_kept(
    client: httpx2.AsyncClient, make_token, verify_session: AsyncSession
) -> None:
    with_email = make_token("user_e", email="e@example.com")
    first = await client.get("/v1/me", headers={"Authorization": f"Bearer {with_email}"})
    assert first.json()["email"] == "e@example.com"

    without_email = make_token("user_e")
    second = await client.get("/v1/me", headers={"Authorization": f"Bearer {without_email}"})
    assert second.json()["email"] == "e@example.com"

    stored = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_e"))
    assert stored.email == "e@example.com"
