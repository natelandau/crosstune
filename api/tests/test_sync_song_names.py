"""An install that predates tunes syncs in song names until it updates."""

from __future__ import annotations

import logging
import uuid
from typing import TYPE_CHECKING

import pytest

from crosstune.models import RecordingLink, UserTune
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
