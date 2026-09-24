"""An install that predates tunes syncs in song names until it updates."""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

import pytest

from crosstune.models import ListItem, Recording, RecordingLink, Tune, UserTune
from tests.test_push import T0, T1, change, push, uid

if TYPE_CHECKING:
    import httpx2
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


async def push_in_song_names(
    client: httpx2.AsyncClient, headers: dict, *changes: dict, query: str = ""
) -> list[dict]:
    response = await client.post(
        f"/v1/sync/push{query}", json={"changes": list(changes)}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["results"]


async def test_a_push_in_song_names_is_stored_as_tunes_and_answered_in_song_names(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song, user_song = uid(), uid()
    results = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="Sally Goodin"),
        change("user_songs", user_song, T0, song_id=song, status="known"),
    )
    assert [r["table"] for r in results] == ["songs", "user_songs"]
    assert [r["status"] for r in results] == ["applied", "applied"]
    assert results[1]["row"]["song_id"] == song
    assert "tune_id" not in results[1]["row"]
    stored = await verify_session.get(UserTune, uuid.UUID(user_song))
    assert stored is not None
    assert stored.tune_id == uuid.UUID(song)


async def test_a_push_in_song_names_can_ask_for_an_answer_in_tune_names(
    client, auth_headers
) -> None:
    song, user_song = uid(), uid()
    results = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="Sally Goodin"),
        change("user_songs", user_song, T0, song_id=song, status="known"),
        query="?names=tunes",
    )
    assert [r["table"] for r in results] == ["tunes", "user_tunes"]
    assert results[1]["row"]["tune_id"] == song


async def test_a_table_that_kept_its_name_still_answers_with_song_fields(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song, link = uid(), uid()
    results = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="Sally Goodin"),
        change(
            "recording_links",
            link,
            T0,
            song_id=song,
            url="https://example.com/x",
            provider="other",
            title="x",
        ),
    )
    assert results[1]["table"] == "recording_links"
    assert results[1]["row"]["song_id"] == song
    assert "tune_id" not in results[1]["row"]
    stored = await verify_session.get(RecordingLink, uuid.UUID(link))
    assert stored is not None
    assert stored.tune_id == uuid.UUID(song)


async def test_a_delete_in_song_names_is_applied_and_answered_in_song_names(
    client, auth_headers
) -> None:
    song = uid()
    await push_in_song_names(
        client, auth_headers("user_a"), change("songs", song, T0, title="Sally Goodin")
    )
    [result] = await push_in_song_names(
        client, auth_headers("user_a"), change("songs", song, T1, op="delete")
    )
    assert result["table"] == "songs"
    assert result["status"] == "applied"
    assert result["row"]["deleted_at"] is not None


async def test_pull_answers_in_song_names_unless_asked_for_tune_names(client, auth_headers) -> None:
    tune, user_tune = uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="Sally Goodin"),
        change("user_tunes", user_tune, T0, tune_id=tune, status="known"),
    )
    songs = (await client.get("/v1/sync/pull?since=0", headers=auth_headers("user_a"))).json()
    assert {r["table"] for r in songs["rows"]} == {"songs", "user_songs"}
    [user_song_row] = [r["row"] for r in songs["rows"] if r["table"] == "user_songs"]
    assert user_song_row["song_id"] == tune
    assert "tune_id" not in user_song_row

    tunes = (
        await client.get("/v1/sync/pull?since=0&names=tunes", headers=auth_headers("user_a"))
    ).json()
    assert {r["table"] for r in tunes["rows"]} == {"tunes", "user_tunes"}
    assert tunes["next_since"] == songs["next_since"]


async def test_a_recording_pushed_in_song_names_is_stored_and_answered_with_song_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song, rec = uid(), uid()
    await push_in_song_names(
        client, auth_headers("user_a"), change("songs", song, T0, title="Angeline")
    )
    [result] = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change(
            "recordings",
            rec,
            T0,
            song_id=song,
            source="microphone",
            recorded_at=T0.isoformat(),
            position=0,
        ),
    )
    assert result["table"] == "recordings"
    assert result["row"]["song_id"] == song
    assert "tune_id" not in result["row"]
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    assert stored is not None
    assert stored.tune_id == uuid.UUID(song)

    pulled = (await client.get("/v1/sync/pull?since=0", headers=auth_headers("user_a"))).json()
    [recording_row] = [r["row"] for r in pulled["rows"] if r["table"] == "recordings"]
    assert recording_row["song_id"] == song
    assert "tune_id" not in recording_row


async def test_a_list_item_pushed_in_song_names_is_stored_and_answered_with_user_song_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song, user_song, list_id, item = uid(), uid(), uid(), uid()
    await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="Angeline"),
        change("user_songs", user_song, T0, song_id=song, status="known"),
        change("lists", list_id, T0, name="Friday"),
    )
    [result] = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("list_items", item, T0, list_id=list_id, user_song_id=user_song),
    )
    assert result["table"] == "list_items"
    assert result["row"]["user_song_id"] == user_song
    assert "user_tune_id" not in result["row"]
    stored = await verify_session.get(ListItem, uuid.UUID(item))
    assert stored is not None
    assert stored.user_tune_id == uuid.UUID(user_song)

    pulled = (await client.get("/v1/sync/pull?since=0", headers=auth_headers("user_a"))).json()
    [item_row] = [r["row"] for r in pulled["rows"] if r["table"] == "list_items"]
    assert item_row["user_song_id"] == user_song
    assert "user_tune_id" not in item_row


async def test_a_stale_push_in_song_names_is_answered_in_song_names(client, auth_headers) -> None:
    song = uid()
    await push_in_song_names(
        client, auth_headers("user_a"), change("songs", song, T1, title="Newer")
    )
    [result] = await push_in_song_names(
        client, auth_headers("user_a"), change("songs", song, T0, title="Older")
    )
    assert result["status"] == "stale"
    assert result["table"] == "songs"


async def test_a_stale_user_songs_push_in_song_names_returns_song_id(client, auth_headers) -> None:
    song, user_song = uid(), uid()
    await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change("user_songs", user_song, T1, song_id=song, status="known"),
    )
    [result] = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("user_songs", user_song, T0, song_id=song, status="learning"),
    )
    assert result["status"] == "stale"
    assert result["row"]["song_id"] == song
    assert "tune_id" not in result["row"]


async def test_a_request_in_song_names_is_logged_with_its_client_version(
    client, auth_headers, caplog
) -> None:
    headers = {**auth_headers("user_a"), "X-Client-Version": "0.6.0"}
    with caplog.at_level(logging.INFO, logger="crosstune.sync.router"):
        await client.get("/v1/sync/pull?since=0", headers=headers)
        await client.get("/v1/sync/pull?since=0&names=tunes", headers=headers)
    logged = [r for r in caplog.records if r.getMessage() == "sync: song names"]
    assert len(logged) == 1
    assert logged[0].client_version == "0.6.0"


async def test_a_change_carrying_both_names_for_one_field_is_invalid(client, auth_headers) -> None:
    song, other, user_song = uid(), uid(), uid()
    results = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="Sally Goodin"),
        change("songs", other, T0, title="Cluck Old Hen"),
        change("user_songs", user_song, T0, song_id=song, tune_id=other, status="known"),
    )
    assert results[2]["status"] == "invalid"


async def test_an_old_client_violin_tuning_joins_a_stored_map_in_song_names(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song = uid()
    await push(
        client,
        auth_headers("user_a"),
        change(
            "tunes",
            song,
            T0,
            title="Sally Goodin",
            tunings={"guitar": {"tuning": "DADGAD", "capo": 2}},
        ),
    )
    [result] = await push_in_song_names(
        client,
        auth_headers("user_a"),
        change("songs", song, T1, title="Sally Goodin", violin_tuning="Cross A (AEAE)"),
    )
    assert result["table"] == "songs"
    assert result["status"] == "applied"
    assert result["row"]["violin_tuning"] == "Cross A (AEAE)"
    stored = await verify_session.get(Tune, uuid.UUID(song))
    assert stored is not None
    assert stored.tunings == {
        "guitar": {"tuning": "DADGAD", "capo": 2},
        "violin": {"tuning": "Cross A (AEAE)"},
    }


async def test_an_old_clients_mode_edit_in_song_names_keeps_the_second_part(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    song = uid()
    headers = auth_headers("user_a")
    await push(
        client,
        headers,
        change("tunes", song, T0, title="Cooley's", modes=["major", "minor"]),
    )
    [result] = await push_in_song_names(
        client,
        headers,
        change(
            "songs",
            song,
            T1,
            title="Cooley's",
            feel="Reel",
            mode="dorian",
            modes=["major", "minor"],
        ),
    )
    assert result["row"]["modes"] == ["dorian", "minor"]
    assert result["row"]["mode"] == "dorian"
    stored = await verify_session.get(Tune, uuid.UUID(song))
    assert stored is not None
    assert stored.modes == ["dorian", "minor"]
    assert stored.mode == "dorian"
