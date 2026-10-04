"""Plays and practice sessions are inserted once and never edited or deleted."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select

from crosstune.models import PlayEvent, PracticeSession, User
from crosstune.vocabulary import MAX_EVENT_DURATION_MS, MAX_LOOPS_PER_RECORDING
from tests.helpers import T0, T1, change, push, recording, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


def play(id_: str, at=T0, **data) -> dict:
    fields = {"context": "row", "started_at": at.isoformat(), "listened_ms": 30_000}
    fields.update(data)
    return change("play_events", id_, at, **fields)


def practice(id_: str, recording_id: str, at=T0, **data) -> dict:
    fields = {
        "recording_id": recording_id,
        "started_at": at.isoformat(),
        "duration_ms": 60_000,
        "speed_percent": 75,
        "pitch_cents": 0,
    }
    fields.update(data)
    return change("practice_sessions", id_, at, **fields)


async def _recording(client, headers) -> str:
    recording_id = uid()
    results = await push(client, headers, recording(recording_id))
    assert results[0]["status"] == "applied"
    return recording_id


async def _play_count(verify_session: AsyncSession) -> int:
    return await verify_session.scalar(select(func.count()).select_from(PlayEvent)) or 0


async def test_play_event_insert_is_applied(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    play_id = uid()
    results = await push(client, headers, play(play_id, recording_id=recording_id))
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["id"] == play_id
    stored = await verify_session.get(PlayEvent, uuid.UUID(play_id))
    assert stored is not None
    owner = await verify_session.scalar(select(User.id).where(User.clerk_user_id == "user_a"))
    assert stored.user_id == owner
    assert stored.listened_ms == 30_000
    assert await _play_count(verify_session) == 1


async def test_replayed_play_is_a_no_op(client, auth_headers, verify_session: AsyncSession) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    play_id = uid()
    c = play(play_id, recording_id=recording_id)
    first = await push(client, headers, c)
    second = await push(client, headers, c)
    assert second[0]["status"] == "applied"
    assert second[0]["row"]["server_seq"] == first[0]["row"]["server_seq"]
    stored = await verify_session.get(PlayEvent, uuid.UUID(play_id))
    assert stored.server_seq == first[0]["row"]["server_seq"]
    assert await _play_count(verify_session) == 1


async def test_event_with_changed_data_on_replay_keeps_the_first(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    play_id = uid()
    await push(client, headers, play(play_id, recording_id=recording_id, listened_ms=20_000))
    results = await push(
        client, headers, play(play_id, at=T1, recording_id=recording_id, listened_ms=90_000)
    )
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["listened_ms"] == 20_000
    stored = await verify_session.get(PlayEvent, uuid.UUID(play_id))
    assert stored.listened_ms == 20_000


async def test_event_delete_is_invalid(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    play_id = uid()
    await push(client, headers, play(play_id, recording_id=recording_id))
    results = await push(client, headers, change("play_events", play_id, T1, op="delete"))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "play_events are insert-only"


@pytest.mark.parametrize("sources", ["both", "neither"])
async def test_play_needs_exactly_one_of_recording_and_link(
    client, auth_headers, verify_session: AsyncSession, sources: str
) -> None:
    headers = auth_headers("user_a")
    tune_id, link_id = uid(), uid()
    recording_id = await _recording(client, headers)
    setup = await push(
        client,
        headers,
        change("tunes", tune_id, T0, title="Sally Ann"),
        change(
            "recording_links",
            link_id,
            T0,
            tune_id=tune_id,
            url="https://youtu.be/x",
            provider="youtube",
            title="Sally Ann",
        ),
    )
    assert [result["status"] for result in setup] == ["applied", "applied"]
    fields = {"recording_id": recording_id, "link_id": link_id} if sources == "both" else {}
    results = await push(client, headers, play(uid(), **fields))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"].startswith("invalid fields")
    assert await _play_count(verify_session) == 0


async def test_play_against_soft_deleted_recording_is_applied(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    await push(client, headers, change("recordings", recording_id, T1, op="delete"))
    results = await push(client, headers, play(uid(), recording_id=recording_id))
    assert results[0]["status"] == "applied"


async def _link(client, headers) -> tuple[str, str]:
    tune_id, link_id = uid(), uid()
    results = await push(
        client,
        headers,
        change("tunes", tune_id, T0, title="Sally Ann"),
        change(
            "recording_links",
            link_id,
            T0,
            tune_id=tune_id,
            url="https://youtu.be/x",
            provider="youtube",
            title="Sally Ann",
        ),
    )
    assert [result["status"] for result in results] == ["applied", "applied"]
    return tune_id, link_id


async def test_play_against_soft_deleted_tune_and_link_is_applied(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    tune_id, link_id = await _link(client, headers)
    deleted = await push(client, headers, change("tunes", tune_id, T1, op="delete"))
    assert deleted[0]["status"] == "applied"
    results = await push(client, headers, play(uid(), tune_id=tune_id, link_id=link_id))
    assert results[0]["status"] == "applied"


async def test_play_against_soft_deleted_list_is_applied(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    recording_id, list_id = await _recording(client, headers), uid()
    await push(client, headers, change("lists", list_id, T0, name="Jam"))
    deleted = await push(client, headers, change("lists", list_id, T1, op="delete"))
    assert deleted[0]["status"] == "applied"
    results = await push(
        client,
        headers,
        play(uid(), recording_id=recording_id, context="list", list_id=list_id),
    )
    assert results[0]["status"] == "applied"


async def test_play_against_foreign_recording_is_invalid(client, auth_headers) -> None:
    recording_id = await _recording(client, auth_headers("user_b"))
    results = await push(client, auth_headers("user_a"), play(uid(), recording_id=recording_id))
    assert results[0]["status"] == "invalid"
    assert "recording_id" in results[0]["reason"]


async def test_play_against_missing_recording_is_invalid(client, auth_headers) -> None:
    results = await push(client, auth_headers("user_a"), play(uid(), recording_id=uid()))
    assert results[0]["status"] == "invalid"
    assert "recording_id" in results[0]["reason"]


async def test_list_id_needs_the_list_context(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    recording_id, list_id = await _recording(client, headers), uid()
    await push(client, headers, change("lists", list_id, T0, name="Jam"))
    in_list, outside = await push(
        client,
        headers,
        play(uid(), recording_id=recording_id, context="list", list_id=list_id),
        play(uid(), recording_id=recording_id, context="row", list_id=list_id),
    )
    assert in_list["status"] == "applied"
    assert outside["status"] == "invalid"


async def test_practice_session_insert_is_applied(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    session_id, loop_ids = uid(), [uid(), uid()]
    results = await push(client, headers, practice(session_id, recording_id, loop_ids=loop_ids))
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["loop_ids"] == loop_ids
    stored = await verify_session.get(PracticeSession, uuid.UUID(session_id))
    assert [str(loop_id) for loop_id in stored.loop_ids] == loop_ids


async def test_practice_session_against_soft_deleted_recording_is_applied(
    client, auth_headers
) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    await push(client, headers, change("recordings", recording_id, T1, op="delete"))
    results = await push(client, headers, practice(uid(), recording_id))
    assert results[0]["status"] == "applied"


async def test_practice_session_against_foreign_recording_is_invalid(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    theirs = await _recording(client, auth_headers("user_b"))
    results = await push(client, auth_headers("user_a"), practice(uid(), theirs))
    assert results[0]["status"] == "invalid"
    assert "recording_id" in results[0]["reason"]
    count = await verify_session.scalar(select(func.count()).select_from(PracticeSession))
    assert count == 0


async def test_practice_session_against_foreign_tune_is_invalid(client, auth_headers) -> None:
    their_tune, _ = await _link(client, auth_headers("user_b"))
    headers = auth_headers("user_a")
    mine = await _recording(client, headers)
    results = await push(client, headers, practice(uid(), mine, tune_id=their_tune))
    assert results[0]["status"] == "invalid"
    assert "tune_id" in results[0]["reason"]


async def test_practice_session_delete_is_invalid(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    session_id = uid()
    await push(client, headers, practice(session_id, await _recording(client, headers)))
    results = await push(client, headers, change("practice_sessions", session_id, T1, op="delete"))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "practice_sessions are insert-only"


async def test_practice_session_with_too_many_loops_is_invalid(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    loop_ids = [uid() for _ in range(MAX_LOOPS_PER_RECORDING + 1)]
    results = await push(client, headers, practice(uid(), recording_id, loop_ids=loop_ids))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "invalid fields: loop_ids"


async def test_event_push_with_another_users_id_is_invalid(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    play_id = uid()
    theirs = await _recording(client, auth_headers("user_b"))
    await push(client, auth_headers("user_b"), play(play_id, recording_id=theirs))
    mine = await _recording(client, auth_headers("user_a"))
    results = await push(client, auth_headers("user_a"), play(play_id, recording_id=mine))
    assert results[0]["status"] == "invalid"
    assert results[0]["reason"] == "id is not yours"
    stored = await verify_session.get(PlayEvent, uuid.UUID(play_id))
    assert str(stored.recording_id) == theirs


@pytest.mark.parametrize("too_long", [2**31, MAX_EVENT_DURATION_MS + 1])
@pytest.mark.parametrize(
    ("table", "field"),
    [
        ("play_events", "listened_ms"),
        ("practice_sessions", "duration_ms"),
        ("scan_views", "viewed_ms"),
    ],
)
async def test_an_event_longer_than_a_day_is_invalid_and_the_batch_goes_on(
    client, auth_headers, table: str, field: str, too_long: int
) -> None:
    headers = auth_headers("user_a")
    recording_id = await _recording(client, headers)
    tune_id = uid()
    events = {
        "play_events": lambda **data: play(uid(), recording_id=recording_id, **data),
        "practice_sessions": lambda **data: practice(uid(), recording_id, **data),
        "scan_views": lambda **data: change(
            "scan_views",
            uid(),
            T0,
            tune_id=tune_id,
            context="tune",
            started_at=T0.isoformat(),
            **data,
        ),
    }
    event = events[table]
    results = await push(
        client,
        headers,
        change("tunes", tune_id, T0, title="Sally Ann"),
        event(**{field: too_long}),
        event(**{field: MAX_EVENT_DURATION_MS}),
    )
    assert [result["status"] for result in results] == ["applied", "invalid", "applied"]
    assert results[1]["reason"] == f"invalid fields: {field}"
