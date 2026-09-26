"""User provisioning."""

import asyncio

import httpx2
import pytest
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.models import DeletedAccount, User
from crosstune.models.user import utc_now
from crosstune.users.service import purge_account

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


async def test_email_claim_is_updated_when_it_changes(
    client: httpx2.AsyncClient, make_token, verify_session: AsyncSession
) -> None:
    first = make_token("user_f", email="old@example.com")
    await client.get("/v1/me", headers={"Authorization": f"Bearer {first}"})

    second = make_token("user_f", email="new@example.com")
    response = await client.get("/v1/me", headers={"Authorization": f"Bearer {second}"})
    assert response.json()["email"] == "new@example.com"

    stored = await verify_session.scalar(select(User).where(User.clerk_user_id == "user_f"))
    assert stored.email == "new@example.com"


async def test_denylisted_token_is_refused_and_creates_nothing(
    client: httpx2.AsyncClient, auth_headers, verify_session: AsyncSession
) -> None:
    await verify_session.execute(
        insert(DeletedAccount).values(clerk_user_id="user_gone", deleted_at=utc_now())
    )
    await verify_session.commit()
    response = await client.get("/v1/me", headers=auth_headers("user_gone"))
    assert response.status_code == 401
    assert await verify_session.scalar(select(func.count()).select_from(User)) == 0


async def test_existing_user_keeps_its_id(client: httpx2.AsyncClient, auth_headers) -> None:
    first = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()["id"]
    second = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()["id"]
    assert first == second


async def test_a_first_request_waits_for_a_concurrent_purge_of_the_same_clerk_id(
    engine, client: httpx2.AsyncClient, auth_headers, verify_session: AsyncSession
) -> None:
    """A purge in flight must not let a racing first request slip in and re-create the row."""
    clerk_user_id = "user_racing"
    async with engine.connect() as purge_conn:
        purge_trans = await purge_conn.begin()
        purge_session = AsyncSession(
            bind=purge_conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            await purge_account(purge_session, clerk_user_id)

            request = asyncio.create_task(client.get("/v1/me", headers=auth_headers(clerk_user_id)))
            await asyncio.sleep(0.1)
            assert not request.done()

            # Releasing the purge's transaction is what frees the advisory lock.
            await purge_trans.commit()
            response = await asyncio.wait_for(request, timeout=5)
        finally:
            await purge_session.close()

    assert response.status_code == 401
    assert (
        await verify_session.scalar(select(User).where(User.clerk_user_id == clerk_user_id)) is None
    )
