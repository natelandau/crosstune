"""A new account gets a trial, or the comp promised to its email, exactly once."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.billing.grants import grant_comp, revoke_comp, set_trial_end
from crosstune.db.base import utc_now
from crosstune.models import Entitlement, Grant, PendingComp, User
from crosstune.vocabulary import GrantKind, GrantSource

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


async def _grants(session: AsyncSession) -> list[Grant]:
    return list((await session.scalars(select(Grant))).all())


async def test_first_request_starts_a_trial(client, auth_headers, verify_session) -> None:
    before = utc_now()
    assert (await client.get("/v1/me", headers=auth_headers("user_a"))).status_code == 200

    (grant,) = await _grants(verify_session)
    assert (grant.kind, grant.source) == (GrantKind.PREMIUM, GrantSource.TRIAL)
    assert grant.expires_at is not None
    assert before + timedelta(days=30) <= grant.expires_at <= utc_now() + timedelta(days=30)
    entitlement = await verify_session.scalar(select(Entitlement))
    assert entitlement.premium_source == GrantSource.TRIAL
    assert entitlement.trial_ends_at == grant.expires_at


async def test_pending_comp_replaces_the_trial(
    client, auth_headers, make_token, verify_session
) -> None:
    verify_session.add(PendingComp(email="friend@example.com", storage_addon=True))
    await verify_session.commit()
    headers = {"Authorization": f"Bearer {make_token('user_a', email='Friend@Example.com')}"}

    assert (await client.get("/v1/me", headers=headers)).status_code == 200

    grants = await _grants(verify_session)
    assert {(g.kind, g.source) for g in grants} == {
        (GrantKind.PREMIUM, GrantSource.COMP),
        (GrantKind.STORAGE_ADDON, GrantSource.COMP),
    }
    assert all(g.expires_at is None for g in grants)
    assert await verify_session.scalar(select(PendingComp)) is None
    entitlement = await verify_session.scalar(select(Entitlement))
    assert entitlement.premium_source == GrantSource.COMP


async def test_an_expired_pending_comp_is_dropped_and_the_trial_starts(
    client, make_token, verify_session
) -> None:
    verify_session.add(
        PendingComp(email="friend@example.com", expires_at=utc_now() - timedelta(days=1))
    )
    await verify_session.commit()
    headers = {"Authorization": f"Bearer {make_token('user_a', email='friend@example.com')}"}

    assert (await client.get("/v1/me", headers=headers)).status_code == 200

    (grant,) = await _grants(verify_session)
    assert (grant.kind, grant.source) == (GrantKind.PREMIUM, GrantSource.TRIAL)
    assert await verify_session.scalar(select(PendingComp)) is None


async def test_later_requests_create_nothing(client, auth_headers, verify_session) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    first = {g.id for g in await _grants(verify_session)}
    seq = (await verify_session.scalar(select(Entitlement))).server_seq
    await verify_session.rollback()

    await client.get("/v1/me", headers=auth_headers("user_a"))

    assert {g.id for g in await _grants(verify_session)} == first
    assert (await verify_session.scalar(select(Entitlement))).server_seq == seq


async def test_a_changed_email_on_an_existing_user_grants_nothing(
    client, make_token, verify_session
) -> None:
    verify_session.add(PendingComp(email="new@example.com"))
    await verify_session.commit()
    first = {"Authorization": f"Bearer {make_token('user_a', email='old@example.com')}"}
    later = {"Authorization": f"Bearer {make_token('user_a', email='new@example.com')}"}

    await client.get("/v1/me", headers=first)
    trial = {g.id for g in await _grants(verify_session)}
    await verify_session.rollback()
    await client.get("/v1/me", headers=later)

    assert {g.id for g in await _grants(verify_session)} == trial
    assert (await verify_session.scalar(select(User))).email == "new@example.com"
    assert await verify_session.scalar(select(PendingComp)) is not None


async def test_a_token_without_an_email_gets_a_trial(client, make_token, verify_session) -> None:
    headers = {"Authorization": f"Bearer {make_token('user_a', email=None)}"}

    assert (await client.get("/v1/me", headers=headers)).status_code == 200

    (grant,) = await _grants(verify_session)
    assert (grant.kind, grant.source) == (GrantKind.PREMIUM, GrantSource.TRIAL)


async def test_grant_comp_stores_who_and_why(client, auth_headers, verify_session) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    user_id = (await verify_session.scalar(select(User))).id

    grant = await grant_comp(
        verify_session,
        user_id,
        expires_at=None,
        storage_addon=False,
        granted_by="operator",
        reason="beta tester",
        now=utc_now(),
    )

    assert (grant.granted_by, grant.reason) == ("operator", "beta tester")


async def test_comp_upsert_revoke_and_trial_end(client, auth_headers, verify_session) -> None:
    await client.get("/v1/me", headers=auth_headers("user_a"))
    user_id = (await verify_session.scalar(select(User))).id
    now = utc_now()

    with pytest.raises(LookupError):
        await set_trial_end(verify_session, uuid.uuid4(), now)
    await set_trial_end(verify_session, user_id, now + timedelta(days=3))
    for addon in (True, False):
        await grant_comp(
            verify_session,
            user_id,
            expires_at=None,
            storage_addon=addon,
            granted_by="t",
            reason="r",
            now=now,
        )
    addon_grant = await verify_session.scalar(
        select(Grant).where(Grant.kind == GrantKind.STORAGE_ADDON)
    )
    assert addon_grant.expires_at == now

    assert await revoke_comp(verify_session, user_id, now) is True
    assert await revoke_comp(verify_session, user_id, now) is False
