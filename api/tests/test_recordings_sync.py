"""Recordings sync like every other table, with server-owned columns a client cannot write."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from crosstune.models import Recording
from tests.test_pull import pull
from tests.test_push import T0, T1, change, push, uid

pytestmark = pytest.mark.anyio


def recording(id_: str, at=T0, **data) -> dict:
    fields = {"source": "microphone", "recorded_at": at.isoformat(), "position": 0}
    fields.update(data)
    return change("recordings", id_, at, **fields)


async def test_push_creates_a_pending_recording(client, auth_headers) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec, label="Soldier's Joy"))
    assert result["status"] == "applied"
    row = result["row"]
    assert row["state"] == "pending_upload"
    assert row["tune_id"] is None
    assert row["duration_ms"] is None
    assert "playback_key" not in row


async def test_push_attaches_to_an_owned_tune(client, auth_headers) -> None:
    tune, rec = uid(), uid()
    await push(client, auth_headers("user_a"), change("tunes", tune, T0, title="Angeline"))
    [result] = await push(client, auth_headers("user_a"), recording(rec, tune_id=tune))
    assert result["status"] == "applied"
    assert result["row"]["tune_id"] == tune


async def test_push_rejects_another_users_tune(client, auth_headers) -> None:
    tune, rec = uid(), uid()
    await push(client, auth_headers("user_b"), change("tunes", tune, T0, title="B's"))
    [result] = await push(client, auth_headers("user_a"), recording(rec, tune_id=tune))
    assert result["status"] == "invalid"
    assert "tune_id" in result["reason"]


async def test_push_cannot_write_server_owned_columns(client, auth_headers) -> None:
    rec = uid()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, state="ready", playback_key="x")
    )
    assert result["status"] == "invalid"
    assert "invalid fields" in result["reason"]


async def test_client_upsert_keeps_server_owned_columns(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_key="k", playback_bytes=1234, duration_ms=61000)
    )
    await verify_session.commit()
    [result] = await push(client, auth_headers("user_a"), recording(rec, T1, label="Renamed"))
    assert result["status"] == "applied"
    assert result["row"]["label"] == "Renamed"
    assert result["row"]["state"] == "ready"
    assert result["row"]["playback_bytes"] == 1234
    assert result["row"]["duration_ms"] == 61000


async def test_pull_returns_recordings(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    body = await pull(client, auth_headers("user_a"))
    assert [r["table"] for r in body["rows"]] == ["recordings"]


async def test_deleting_a_tune_soft_deletes_its_recordings(
    client, auth_headers, verify_session
) -> None:
    tune, rec = uid(), uid()
    await push(client, auth_headers("user_a"), change("tunes", tune, T0, title="X"))
    await push(client, auth_headers("user_a"), recording(rec, tune_id=tune))
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, op="delete"))
    stored = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    assert stored.deleted_at is not None


async def test_user_settings_carry_audio_quality(client, auth_headers) -> None:
    settings = uid()
    [result] = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings, T0, instruments=["violin"], audio_quality="high"),
    )
    assert result["status"] == "applied"
    assert result["row"]["audio_quality"] == "high"
    [bad] = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings, T1, instruments=["violin"], audio_quality="best"),
    )
    assert bad["status"] == "invalid"
