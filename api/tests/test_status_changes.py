"""Every change of a user tune's status is recorded as it is pushed."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.models import StatusChange
from tests.helpers import T0, T1, T2, change, push, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


async def _tune(client, headers) -> str:
    tune_id = uid()
    await push(client, headers, change("tunes", tune_id, T0, title="Angeline the Baker", key="D"))
    return tune_id


def _user_tune(id_: str, tune_id: str, at, status: str, **data) -> dict:
    return change("user_tunes", id_, at, tune_id=tune_id, status=status, **data)


async def _rows(verify_session: AsyncSession) -> list[StatusChange]:
    result = await verify_session.scalars(select(StatusChange).order_by(StatusChange.changed_at))
    return list(result)


async def test_new_user_tune_writes_initial_status_row(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    rows = await _rows(verify_session)
    assert len(rows) == 1
    assert rows[0].user_tune_id == uuid.UUID(us_id)
    assert rows[0].from_status is None
    assert rows[0].to_status == "learning"
    assert rows[0].changed_at == T0


async def test_status_change_writes_a_row(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    await push(client, headers, _user_tune(us_id, tune_id, T1, "known"))
    rows = await _rows(verify_session)
    assert len(rows) == 2
    assert (rows[1].from_status, rows[1].to_status, rows[1].changed_at) == (
        "learning",
        "known",
        T1,
    )


async def test_edit_without_status_change_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    results = await push(client, headers, _user_tune(us_id, tune_id, T1, "learning", notes="x"))
    assert results[0]["status"] == "applied"
    assert len(await _rows(verify_session)) == 1


async def test_stale_status_change_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T1, "learning"))
    results = await push(client, headers, _user_tune(us_id, tune_id, T0, "known"))
    assert results[0]["status"] == "stale"
    assert len(await _rows(verify_session)) == 1


async def test_equal_timestamp_replay_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    await push(client, headers, _user_tune(us_id, tune_id, T0, "known"))
    assert len(await _rows(verify_session)) == 1


async def test_status_change_on_undelete_counts_as_change(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    await push(client, headers, change("user_tunes", us_id, T1, op="delete"))
    await push(client, headers, _user_tune(us_id, tune_id, T2, "known"))
    rows = await _rows(verify_session)
    assert [(r.from_status, r.to_status) for r in rows] == [
        (None, "learning"),
        ("learning", "known"),
    ]


async def test_undelete_with_same_status_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id, us_id = await _tune(client, headers), uid()
    await push(client, headers, _user_tune(us_id, tune_id, T0, "learning"))
    await push(client, headers, change("user_tunes", us_id, T1, op="delete"))
    results = await push(client, headers, _user_tune(us_id, tune_id, T2, "learning"))
    assert results[0]["status"] == "applied"
    assert len(await _rows(verify_session)) == 1


async def test_user_tune_with_another_users_id_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    us_id = uid()
    theirs = auth_headers("user_b")
    await push(client, theirs, _user_tune(us_id, await _tune(client, theirs), T0, "learning"))
    mine = auth_headers("user_a")
    results = await push(client, mine, _user_tune(us_id, await _tune(client, mine), T1, "known"))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "id is not yours"
    assert [(r.from_status, r.to_status) for r in await _rows(verify_session)] == [
        (None, "learning")
    ]


async def test_user_tune_constraint_violation_writes_nothing(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    await push(client, headers, _user_tune(uid(), tune_id, T0, "learning"))
    results = await push(client, headers, _user_tune(uid(), tune_id, T1, "known"))
    assert results[0]["status"] == "invalid"
    assert "constraint violation" in results[0]["reason"]
    assert len(await _rows(verify_session)) == 1


async def test_status_changes_is_not_pushable(client, auth_headers) -> None:
    body = {"changes": [change("status_changes", uid(), T0, to_status="known")]}
    response = await client.post("/v1/sync/push", json=body, headers=auth_headers("user_a"))
    assert response.status_code == 422
