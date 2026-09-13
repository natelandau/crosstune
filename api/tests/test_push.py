"""Push semantics: last-write-wins, isolation of invalid changes, ownership, cascade."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from crosstune.models import ListItem, RecordingLink, Song, UserSong

if TYPE_CHECKING:
    import httpx2
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

T0 = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
T1 = T0 + timedelta(seconds=10)
T2 = T0 + timedelta(seconds=20)


def uid() -> str:
    return str(uuid.uuid4())


def change(table: str, id_: str, updated_at: datetime, op: str = "upsert", **data) -> dict:
    body = {"table": table, "op": op, "id": id_, "updated_at": updated_at.isoformat()}
    if op == "upsert":
        body["data"] = {"created_at": updated_at.isoformat(), **data}
    return body


async def push(client: httpx2.AsyncClient, headers: dict, *changes: dict) -> list[dict]:
    response = await client.post("/v1/sync/push", json={"changes": list(changes)}, headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["results"]


async def test_batch_creates_song_user_song_and_link(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song_id, us_id, link_id = uid(), uid(), uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song_id, T0, title="Angeline the Baker", key="D"),
        change("user_songs", us_id, T0, song_id=song_id, status="known"),
        change(
            "recording_links",
            link_id,
            T0,
            song_id=song_id,
            url="https://example.com/x",
            provider="other",
            title="x",
        ),
    )
    assert [r["status"] for r in results] == ["applied", "applied", "applied"]
    song = await verify_session.get(Song, uuid.UUID(song_id))
    assert song is not None
    assert song.title == "Angeline the Baker"
    assert song.server_seq >= 1
    assert results[0]["row"]["server_seq"] == song.server_seq


async def test_owner_comes_from_token_not_body(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", uid(), T0, title="Sally Ann", owner_user_id=uid()),
    )
    assert results[0]["status"] == "invalid"


async def test_older_write_is_stale_and_returns_current_row(client, auth_headers) -> None:
    song_id = uid()
    await push(client, auth_headers("user_a"), change("songs", song_id, T1, title="Newer"))
    results = await push(
        client, auth_headers("user_a"), change("songs", song_id, T0, title="Older")
    )
    assert results[0]["status"] == "stale"
    assert results[0]["row"]["title"] == "Newer"


async def test_newer_write_is_applied(client, auth_headers, verify_session: AsyncSession) -> None:
    song_id = uid()
    await push(client, auth_headers("user_a"), change("songs", song_id, T0, title="First"))
    results = await push(
        client, auth_headers("user_a"), change("songs", song_id, T1, title="Second")
    )
    assert results[0]["status"] == "applied"
    song = await verify_session.get(Song, uuid.UUID(song_id))
    assert song.title == "Second"


async def test_replay_is_a_no_op(client, auth_headers, verify_session: AsyncSession) -> None:
    song_id = uid()
    c = change("songs", song_id, T0, title="Once")
    await push(client, auth_headers("user_a"), c)
    seq_before = (await verify_session.get(Song, uuid.UUID(song_id))).server_seq
    results = await push(client, auth_headers("user_a"), c)
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    seq_after = (await verify_session.get(Song, uuid.UUID(song_id))).server_seq
    assert seq_after == seq_before


async def test_invalid_change_does_not_reject_the_batch(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", uid(), T0, title="Good"),
        change("songs", uid(), T0, title="Bad", mode="lydian"),
        change("songs", uid(), T0, title="Also good"),
    )
    assert [r["status"] for r in results] == ["applied", "invalid", "applied"]
    assert "mode" in results[1]["reason"]


async def test_cannot_reference_another_users_song(client, auth_headers) -> None:
    song_id = uid()
    await push(client, auth_headers("user_a"), change("songs", song_id, T0, title="Mine"))
    results = await push(
        client,
        auth_headers("user_b"),
        change("user_songs", uid(), T0, song_id=song_id, status="known"),
    )
    assert results[0]["status"] == "invalid"


async def test_cannot_overwrite_another_users_row_by_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song_id = uid()
    await push(client, auth_headers("user_a"), change("songs", song_id, T0, title="Mine"))
    results = await push(
        client, auth_headers("user_b"), change("songs", song_id, T2, title="Stolen")
    )
    assert results[0]["status"] == "invalid"
    assert results[0]["row"] is None
    song = await verify_session.get(Song, uuid.UUID(song_id))
    assert song.title == "Mine"


async def test_cannot_overwrite_another_users_list_item_by_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song_a, us_a, list_a, item_id = uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song_a, T0, title="A's song"),
        change("user_songs", us_a, T0, song_id=song_a, status="known"),
        change("lists", list_a, T0, name="A's list"),
        change("list_items", item_id, T0, list_id=list_a, user_song_id=us_a),
    )
    stored = await verify_session.get(ListItem, uuid.UUID(item_id))
    before = (stored.updated_at, stored.server_seq)

    song_b, us_b, list_b = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_b"),
        change("songs", song_b, T0, title="B's song"),
        change("user_songs", us_b, T0, song_id=song_b, status="known"),
        change("lists", list_b, T0, name="B's list"),
    )
    results = await push(
        client,
        auth_headers("user_b"),
        change("list_items", item_id, T2, list_id=list_b, user_song_id=us_b),
    )
    assert results[0]["status"] == "invalid"
    assert results[0]["row"] is None
    verify_session.expire_all()
    item = await verify_session.get(ListItem, uuid.UUID(item_id))
    assert item.list_id == uuid.UUID(list_a)
    assert (item.updated_at, item.server_seq) == before


async def test_duplicate_user_song_is_invalid(client, auth_headers) -> None:
    song_id = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("songs", song_id, T0, title="Dup"),
        change("user_songs", uid(), T0, song_id=song_id, status="known"),
        change("user_songs", uid(), T0, song_id=song_id, status="learning"),
    )
    assert [r["status"] for r in results] == ["applied", "applied", "invalid"]


async def test_delete_song_cascades_soft_delete(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song_id, us_id, link_id, list_id, item_id = uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song_id, T0, title="Gone"),
        change("user_songs", us_id, T0, song_id=song_id, status="known"),
        change(
            "recording_links",
            link_id,
            T0,
            song_id=song_id,
            url="https://example.com",
            provider="other",
            title="x",
        ),
        change("lists", list_id, T0, name="Set"),
        change("list_items", item_id, T0, list_id=list_id, user_song_id=us_id),
    )
    dependents = (
        (Song, song_id),
        (UserSong, us_id),
        (RecordingLink, link_id),
        (ListItem, item_id),
    )
    seq_before = {
        id_: (await verify_session.get(model, uuid.UUID(id_))).server_seq
        for model, id_ in dependents
    }

    results = await push(client, auth_headers("user_a"), change("songs", song_id, T1, op="delete"))
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for model, id_ in dependents:
        row = await verify_session.get(model, uuid.UUID(id_))
        assert row.deleted_at == T1, model.__name__
        assert row.updated_at == T1, model.__name__
        assert row.server_seq > seq_before[id_], model.__name__


async def test_delete_list_cascades_to_items(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song1, song2, us1, us2, list_id, item1, item2 = uid(), uid(), uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song1, T0, title="One"),
        change("songs", song2, T0, title="Two"),
        change("user_songs", us1, T0, song_id=song1, status="known"),
        change("user_songs", us2, T0, song_id=song2, status="known"),
        change("lists", list_id, T0, name="Set"),
        change("list_items", item1, T0, list_id=list_id, user_song_id=us1),
        change("list_items", item2, T0, list_id=list_id, user_song_id=us2),
    )
    seq_before = {
        id_: (await verify_session.get(ListItem, uuid.UUID(id_))).server_seq
        for id_ in (item1, item2)
    }

    results = await push(client, auth_headers("user_a"), change("lists", list_id, T1, op="delete"))
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for id_ in (item1, item2):
        item = await verify_session.get(ListItem, uuid.UUID(id_))
        assert item.deleted_at == T1
        assert item.updated_at == T1
        assert item.server_seq > seq_before[id_]


async def test_delete_user_song_cascades_to_items(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song_id, us_id, list1, list2, item1, item2 = uid(), uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song_id, T0, title="Song"),
        change("user_songs", us_id, T0, song_id=song_id, status="known"),
        change("lists", list1, T0, name="List 1"),
        change("lists", list2, T0, name="List 2"),
        change("list_items", item1, T0, list_id=list1, user_song_id=us_id),
        change("list_items", item2, T0, list_id=list2, user_song_id=us_id),
    )
    seq_before = {
        id_: (await verify_session.get(ListItem, uuid.UUID(id_))).server_seq
        for id_ in (item1, item2)
    }

    results = await push(
        client, auth_headers("user_a"), change("user_songs", us_id, T1, op="delete")
    )
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for id_ in (item1, item2):
        item = await verify_session.get(ListItem, uuid.UUID(id_))
        assert item.deleted_at == T1
        assert item.updated_at == T1
        assert item.server_seq > seq_before[id_]


async def test_delete_unknown_row_is_invalid(client, auth_headers) -> None:
    results = await push(client, auth_headers("user_a"), change("songs", uid(), T0, op="delete"))
    assert results[0]["status"] == "invalid"


async def test_delete_is_idempotent(client, auth_headers) -> None:
    song_id = uid()
    await push(client, auth_headers("user_a"), change("songs", song_id, T0, title="X"))
    first = await push(client, auth_headers("user_a"), change("songs", song_id, T1, op="delete"))
    second = await push(client, auth_headers("user_a"), change("songs", song_id, T1, op="delete"))
    assert first[0]["status"] == "applied"
    assert second[0]["status"] == "applied"


async def test_push_requires_auth(client) -> None:
    response = await client.post("/v1/sync/push", json={"changes": []})
    assert response.status_code == 401


async def test_user_settings_upsert_applies_and_a_second_row_is_invalid(
    client, auth_headers
) -> None:
    first, second = uid(), uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", first, T0, instruments=["violin", "banjo"]),
    )
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["instruments"] == ["violin", "banjo"]
    results = await push(
        client, auth_headers("user_a"), change("user_settings", second, T1, instruments=["guitar"])
    )
    assert results[0]["status"] == "invalid"
    assert "constraint violation" in results[0]["reason"]


async def test_user_settings_newer_write_wins(client, auth_headers) -> None:
    settings_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings_id, T1, instruments=["violin"]),
    )
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings_id, T0, instruments=["banjo"]),
    )
    assert results[0]["status"] == "stale"
    assert results[0]["row"]["instruments"] == ["violin"]


async def test_user_settings_rejects_an_unknown_instrument(client, auth_headers) -> None:
    results = await push(
        client, auth_headers("user_a"), change("user_settings", uid(), T0, instruments=["kazoo"])
    )
    assert results[0]["status"] == "invalid"
    assert "instruments" in results[0]["reason"]
