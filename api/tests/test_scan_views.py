"""Scan views are inserted once and never edited or deleted."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select

from crosstune.models import ScanView, User
from tests.helpers import T0, T1, change, push, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


def view(id_: str, tune_id: str, at=T0, **data) -> dict:
    fields = {
        "tune_id": tune_id,
        "context": "tune",
        "started_at": at.isoformat(),
        "viewed_ms": 12_000,
    }
    fields.update(data)
    return change("scan_views", id_, at, **fields)


async def _tune(client, headers) -> str:
    tune_id = uid()
    results = await push(client, headers, change("tunes", tune_id, T0, title="Sally Ann"))
    assert results[0]["status"] == "applied"
    return tune_id


async def _count(verify_session: AsyncSession) -> int:
    return await verify_session.scalar(select(func.count()).select_from(ScanView)) or 0


async def test_scan_view_insert_is_applied(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    view_id = uid()
    results = await push(client, headers, view(view_id, tune_id))
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["id"] == view_id
    stored = await verify_session.get(ScanView, uuid.UUID(view_id))
    assert stored is not None
    owner = await verify_session.scalar(select(User.id).where(User.clerk_user_id == "user_a"))
    assert stored.user_id == owner
    assert stored.viewed_ms == 12_000
    assert await _count(verify_session) == 1


async def test_replayed_scan_view_is_a_no_op(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    view_id = uid()
    c = view(view_id, tune_id)
    first = await push(client, headers, c)
    second = await push(client, headers, c)
    assert second[0]["status"] == "applied"
    assert second[0]["row"]["server_seq"] == first[0]["row"]["server_seq"]
    assert await _count(verify_session) == 1


async def test_scan_view_with_changed_data_on_replay_keeps_the_first(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    view_id = uid()
    await push(client, headers, view(view_id, tune_id, viewed_ms=4_000))
    results = await push(client, headers, view(view_id, tune_id, at=T1, viewed_ms=90_000))
    assert results[0]["row"]["viewed_ms"] == 4_000
    stored = await verify_session.get(ScanView, uuid.UUID(view_id))
    assert stored.viewed_ms == 4_000


async def test_scan_view_delete_is_invalid(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    view_id = uid()
    await push(client, headers, view(view_id, await _tune(client, headers)))
    results = await push(client, headers, change("scan_views", view_id, T1, op="delete"))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "scan_views are insert-only"


async def test_list_id_needs_the_list_context(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    tune_id, list_id = await _tune(client, headers), uid()
    await push(client, headers, change("lists", list_id, T0, name="Jam"))
    in_list, outside = await push(
        client,
        headers,
        view(uid(), tune_id, context="list", list_id=list_id),
        view(uid(), tune_id, context="row", list_id=list_id),
    )
    assert in_list["status"] == "applied"
    assert outside["status"] == "invalid"


async def test_scan_view_needs_a_known_context_and_non_negative_time(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    bad_context, negative = await push(
        client,
        headers,
        view(uid(), tune_id, context="dock"),
        view(uid(), tune_id, viewed_ms=-1),
    )
    assert bad_context["status"] == "invalid"
    assert negative["status"] == "invalid"


async def test_scan_view_needs_a_tune(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change(
            "scan_views",
            uid(),
            T0,
            context="tune",
            started_at=T0.isoformat(),
            viewed_ms=5_000,
        ),
    )
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"].startswith("invalid fields")


async def test_scan_view_against_soft_deleted_tune_and_list_is_applied(
    client, auth_headers
) -> None:
    headers = auth_headers("user_a")
    tune_id, list_id = await _tune(client, headers), uid()
    await push(client, headers, change("lists", list_id, T0, name="Jam"))
    deleted = await push(
        client,
        headers,
        change("tunes", tune_id, T1, op="delete"),
        change("lists", list_id, T1, op="delete"),
    )
    assert [result["status"] for result in deleted] == ["applied", "applied"]
    results = await push(client, headers, view(uid(), tune_id, context="list", list_id=list_id))
    assert results[0]["status"] == "applied"


async def test_scan_view_against_missing_or_foreign_tune_is_invalid(client, auth_headers) -> None:
    theirs = await _tune(client, auth_headers("user_b"))
    headers = auth_headers("user_a")
    foreign, missing = await push(client, headers, view(uid(), theirs), view(uid(), uid()))
    for result in (foreign, missing):
        assert result["status"] == "invalid"
        assert "tune_id" in result["reason"]


async def test_scan_view_against_missing_or_foreign_list_is_invalid(client, auth_headers) -> None:
    their_list = uid()
    await push(client, auth_headers("user_b"), change("lists", their_list, T0, name="Jam"))
    headers = auth_headers("user_a")
    tune_id = await _tune(client, headers)
    foreign, missing = await push(
        client,
        headers,
        view(uid(), tune_id, context="list", list_id=their_list),
        view(uid(), tune_id, context="list", list_id=uid()),
    )
    for result in (foreign, missing):
        assert result["status"] == "invalid"
        assert "list_id" in result["reason"]


async def test_scan_view_push_with_another_users_id_is_invalid(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    view_id = uid()
    theirs = await _tune(client, auth_headers("user_b"))
    await push(client, auth_headers("user_b"), view(view_id, theirs))
    mine = await _tune(client, auth_headers("user_a"))
    results = await push(client, auth_headers("user_a"), view(view_id, mine))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "id is not yours"
    stored = await verify_session.get(ScanView, uuid.UUID(view_id))
    assert str(stored.tune_id) == theirs
