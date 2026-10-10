"""The entitlements row reaches clients through pull, and only the server writes it."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, get_args

import pytest
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp
from crosstune.db.base import utc_now
from crosstune.models import Entitlement, User
from crosstune.users.router import NOTICE_COLUMNS, Notice
from crosstune.users.service import touch_last_synced
from tests.helpers import T1, change, pull, push

if TYPE_CHECKING:
    import httpx2

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio


async def _comped_user(
    client: httpx2.AsyncClient, headers: dict, session: AsyncSession, settings: Settings
) -> None:
    assert (await client.get("/v1/me", headers=headers)).status_code == 200
    user_id = (await session.scalar(select(User))).id
    now = utc_now()
    await grant_comp(
        session,
        user_id,
        expires_at=None,
        storage_addon=False,
        granted_by="test",
        reason="test",
        now=now,
    )
    await refresh_entitlement(session, user_id, settings, now)
    await session.commit()


def _entitlement_rows(body: dict) -> list[dict]:
    return [r["row"] for r in body["rows"] if r["table"] == "entitlements"]


async def test_pull_carries_the_entitlements_row_once(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    await _comped_user(client, headers, verify_session, settings)

    first = await pull(client, headers)
    (row,) = _entitlement_rows(first)
    assert row["premium_source"] == "comp"
    assert row["user_id"] == str((await verify_session.scalar(select(User))).id)

    again = await pull(client, headers, since=first["next_since"])
    assert _entitlement_rows(again) == []


async def test_push_to_entitlements_is_refused(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    await _comped_user(client, headers, verify_session, settings)
    (row,) = _entitlement_rows(await pull(client, headers))

    (result,) = await push(
        client, headers, change("entitlements", row["id"], T1, premium_source=None)
    )

    assert result["status"] == "invalid"
    assert result["reason"] == "server-written"
    await verify_session.rollback()
    stored = await verify_session.scalar(select(Entitlement))
    assert stored.premium_source == "comp"
    assert stored.server_seq == row["server_seq"]


async def test_delete_of_the_entitlements_row_is_refused(
    client, auth_headers, verify_session, settings
) -> None:
    headers = auth_headers("user_a")
    await _comped_user(client, headers, verify_session, settings)
    (row,) = _entitlement_rows(await pull(client, headers))

    (result,) = await push(client, headers, change("entitlements", row["id"], T1, op="delete"))

    assert result["status"] == "invalid"
    assert result["reason"] == "server-written"
    await verify_session.rollback()
    stored = await verify_session.scalar(select(Entitlement))
    assert stored.deleted_at is None
    assert stored.server_seq == row["server_seq"]


async def test_notice_is_recorded_once_and_pulled(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    first = await pull(client, headers)

    response = await client.post(
        "/v1/me/notices", json={"notice": "first_recording"}, headers=headers
    )
    assert response.status_code == 204
    seen = (await verify_session.scalar(select(Entitlement))).recording_notice_seen_at
    assert seen is not None

    (row,) = _entitlement_rows(await pull(client, headers, since=first["next_since"]))
    assert row["recording_notice_seen_at"] is not None
    assert row["trial_reminder_seen_at"] is None

    after = await pull(client, headers)
    response = await client.post(
        "/v1/me/notices", json={"notice": "first_recording"}, headers=headers
    )
    assert response.status_code == 204
    await verify_session.rollback()
    assert (await verify_session.scalar(select(Entitlement))).recording_notice_seen_at == seen
    assert _entitlement_rows(await pull(client, headers, since=after["next_since"])) == []


async def test_trial_reminder_notice(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    response = await client.post(
        "/v1/me/notices", json={"notice": "trial_reminder"}, headers=headers
    )
    assert response.status_code == 204
    stored = await verify_session.scalar(select(Entitlement))
    assert stored.trial_reminder_seen_at is not None
    assert stored.recording_notice_seen_at is None


async def test_trial_ended_notice_is_recorded_once_and_pulled(
    client, auth_headers, verify_session
) -> None:
    headers = auth_headers("user_a")
    first = await pull(client, headers)

    response = await client.post("/v1/me/notices", json={"notice": "trial_ended"}, headers=headers)
    assert response.status_code == 204
    stored = await verify_session.scalar(select(Entitlement))
    seen = stored.trial_end_seen_at
    assert seen is not None
    assert stored.recording_notice_seen_at is None
    assert stored.trial_reminder_seen_at is None

    (row,) = _entitlement_rows(await pull(client, headers, since=first["next_since"]))
    assert row["trial_end_seen_at"] is not None

    after = await pull(client, headers)
    response = await client.post("/v1/me/notices", json={"notice": "trial_ended"}, headers=headers)
    assert response.status_code == 204
    await verify_session.rollback()
    assert (await verify_session.scalar(select(Entitlement))).trial_end_seen_at == seen
    assert _entitlement_rows(await pull(client, headers, since=after["next_since"])) == []


def test_every_notice_has_a_column() -> None:
    assert set(get_args(Notice)) == set(NOTICE_COLUMNS)
    assert all(hasattr(Entitlement, column) for column in NOTICE_COLUMNS.values())


async def test_unknown_notice_is_refused(client, auth_headers) -> None:
    response = await client.post(
        "/v1/me/notices", json={"notice": "something_else"}, headers=auth_headers("user_a")
    )
    assert response.status_code == 422


async def test_pull_records_last_synced_at_hourly(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    await pull(client, headers)
    synced = (await verify_session.scalar(select(User))).last_synced_at
    assert synced is not None
    await verify_session.rollback()

    await pull(client, headers)
    assert (await verify_session.scalar(select(User))).last_synced_at == synced
    await verify_session.rollback()

    await verify_session.execute(update(User).values(last_synced_at=synced - timedelta(hours=2)))
    await verify_session.commit()
    await pull(client, headers)
    assert (await verify_session.scalar(select(User))).last_synced_at > synced


async def test_push_records_last_synced_at(client, auth_headers, verify_session) -> None:
    await push(client, auth_headers("user_a"))
    assert (await verify_session.scalar(select(User))).last_synced_at is not None


async def test_last_synced_skips_a_locked_user_row(client, auth_headers, engine) -> None:
    """A sync never waits on the user row, so it cannot deadlock with a writer holding it."""
    assert (await client.get("/v1/me", headers=auth_headers("user_a"))).status_code == 200
    async with AsyncSession(engine) as holder, AsyncSession(engine) as syncer:
        user_id = (await holder.execute(select(User.id).with_for_update())).scalar_one()
        # A wait for the row fails fast instead of hanging the test.
        await syncer.execute(text("set local lock_timeout = '2s'"))
        await touch_last_synced(syncer, user_id, utc_now())
        await syncer.commit()
        await holder.rollback()
        assert await holder.scalar(select(User.last_synced_at)) is None
