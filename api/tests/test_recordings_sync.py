"""Recordings sync like every other table, with server-owned columns a client cannot write."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from crosstune.models import Job, Recording
from tests.test_pull import pull
from tests.test_push import T0, T1, T2, change, push, uid

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


async def test_push_keeps_server_columns(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(
            state="ready",
            playback_key="k",
            playback_bytes=1234,
            duration_ms=61000,
            source_duration_ms=61000,
            playback_start_ms=0,
            playback_end_ms=61000,
            playback_rev="abcd1234",
            peaks_key="peaks/k.bin",
            peaks_rev="efgh5678",
            peaks_bytes=999,
        )
    )
    await verify_session.commit()
    [result] = await push(client, auth_headers("user_a"), recording(rec, T1, label="Renamed"))
    assert result["status"] == "applied"
    row = result["row"]
    assert row["label"] == "Renamed"
    assert row["state"] == "ready"
    assert row["playback_bytes"] == 1234
    assert row["duration_ms"] == 61000
    assert row["source_duration_ms"] == 61000
    assert row["playback_start_ms"] == 0
    assert row["playback_end_ms"] == 61000
    assert row["playback_rev"] == "abcd1234"
    assert row["peaks_rev"] == "efgh5678"
    # No trim change is implied, so the row keeps matching its playback file.
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec)) is None


async def test_push_speed_out_of_range_is_invalid(client, auth_headers) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec, speed_percent=40))
    assert result["status"] == "invalid"


async def test_push_clamps_trim_to_playback_range(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_start_ms=500, playback_end_ms=1500)
    )
    await verify_session.commit()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=0, trim_end_ms=3000)
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (500, 1500)
    # The clamped trim already matches the playback file, so no trim job is needed.
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec)) is None


async def test_push_clamps_a_null_trim_end_to_a_narrower_playback_file(
    client, auth_headers, verify_session
) -> None:
    """A null end means the source end, which a trimmed playback file no longer reaches."""
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_start_ms=500, playback_end_ms=1500, source_duration_ms=2000)
    )
    await verify_session.commit()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=500, trim_end_ms=None)
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (500, 1500)
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec)) is None


async def test_push_keeps_a_null_trim_end_when_the_playback_file_reaches_the_source_end(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_start_ms=500, playback_end_ms=2000, source_duration_ms=2000)
    )
    await verify_session.commit()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=500, trim_end_ms=None)
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (500, None)


async def test_push_trim_queues_job(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_start_ms=0, playback_end_ms=5000, source_duration_ms=5000)
    )
    await verify_session.commit()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=500, trim_end_ms=1500)
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (500, 1500)
    jobs = (await verify_session.scalars(select(Job).where(Job.recording_id == rec))).all()
    assert [job.kind for job in jobs] == ["trim"]


async def test_saving_a_trim_wakes_the_runner(
    client, auth_headers, verify_session, fake_runner
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_start_ms=0, playback_end_ms=5000, source_duration_ms=5000)
    )
    await verify_session.commit()
    assert fake_runner.wakes == 0
    await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=500, trim_end_ms=1500)
    )
    assert fake_runner.wakes == 1


async def test_push_trim_before_upload_queues_nothing(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, trim_start_ms=500, trim_end_ms=1500))
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec)) is None


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


async def test_deleting_a_tune_with_a_recording_wakes_the_runner(
    client, auth_headers, fake_runner
) -> None:
    tune, rec = uid(), uid()
    await push(client, auth_headers("user_a"), change("tunes", tune, T0, title="X"))
    await push(client, auth_headers("user_a"), recording(rec, tune_id=tune))
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, title="Y"))
    assert fake_runner.wakes == 0
    await push(client, auth_headers("user_a"), change("tunes", tune, T2, op="delete"))
    assert fake_runner.wakes == 1


async def test_deleting_a_recording_wakes_the_runner(client, auth_headers, fake_runner) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await push(client, auth_headers("user_a"), recording(rec, T1, op="delete"))
    assert fake_runner.wakes == 1


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
