"""Recordings sync like every other table, with server-owned columns a client cannot write."""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select, update

from crosstune.models import Job, Recording
from tests.helpers import T0, T1, T2, change, pull, push, recording, uid

pytestmark = pytest.mark.anyio


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


async def _origin_fields(verify_session, rec: str) -> tuple:
    row = (
        await verify_session.execute(
            select(Recording.source, Recording.origin, Recording.origin_url).where(
                Recording.id == uuid.UUID(rec)
            )
        )
    ).one()
    return tuple(row)


async def test_a_pushed_recording_defaults_to_own(client, auth_headers, verify_session) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec))
    assert result["status"] == "applied"
    assert await _origin_fields(verify_session, rec) == ("microphone", "own", None)


async def test_push_refuses_an_origin_url_on_an_own_recording(client, auth_headers) -> None:
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(uid(), origin_url="https://www.slippery-hill.com/recording/1"),
    )
    assert result["status"] == "invalid"


async def test_push_refuses_an_import_without_an_origin(client, auth_headers) -> None:
    [result] = await push(client, auth_headers("user_a"), recording(uid(), source="import"))
    assert result["status"] == "invalid"


async def test_push_keeps_an_imported_origin(client, auth_headers, verify_session) -> None:
    rec = uid()
    page = "https://www.slippery-hill.com/recording/1"
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, source="import", origin="slippery_hill", origin_url=page),
    )
    assert result["status"] == "applied"
    assert await _origin_fields(verify_session, rec) == ("import", "slippery_hill", page)


PAGE = "https://www.slippery-hill.com/recording/1"


@pytest.mark.parametrize(
    "data",
    [
        {"source": "microphone", "origin": "slippery_hill", "origin_url": PAGE},
        {"source": "import", "origin": "own", "origin_url": PAGE},
        {"source": "import", "origin": "own"},
        {"source": "import", "origin": "slippery_hill", "origin_url": None},
        {"source": "upload", "origin": "own", "origin_url": PAGE},
    ],
    ids=[
        "origin-without-import-source",
        "import-own-with-url",
        "import-own-without-url",
        "import-origin-without-url",
        "upload-own-with-url",
    ],
)
async def test_push_refuses_a_mismatched_provenance(
    client, auth_headers, verify_session, data: dict
) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec, **data))
    assert result["status"] == "invalid"
    stored = await verify_session.execute(
        select(Recording.id).where(Recording.id == uuid.UUID(rec))
    )
    assert stored.first() is None


TUNE_PAGE = "https://www.slippery-hill.com/content/bear-creek-sally-goodin"


def _import(rec: str, at=T0, page: str = TUNE_PAGE, **data) -> dict:
    return recording(rec, at, source="import", origin="slippery_hill", origin_url=page, **data)


async def _job_kinds(verify_session, rec: str) -> list[str]:
    jobs = await verify_session.scalars(select(Job).where(Job.recording_id == uuid.UUID(rec)))
    return [job.kind for job in jobs]


async def test_push_of_a_new_import_queues_an_import_job(
    client, auth_headers, verify_session, fake_runner
) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), _import(rec))
    assert result["status"] == "applied"
    assert result["row"]["state"] == "processing"
    assert result["row"]["error"] is None
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    assert stored.state == "processing"
    assert result["row"]["server_seq"] == stored.server_seq
    assert await _job_kinds(verify_session, rec) == ["import"]
    assert fake_runner.wakes == 1


async def test_push_of_an_import_from_another_host_fails_it(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    [result] = await push(
        client, auth_headers("user_a"), _import(rec, page="https://example.com/x")
    )
    assert result["status"] == "applied"
    assert (result["row"]["state"], result["row"]["error"]) == (
        "failed",
        "Can't import from this address.",
    )
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    assert (stored.state, stored.error) == ("failed", "Can't import from this address.")
    assert await _job_kinds(verify_session, rec) == []


async def test_an_update_to_an_import_queues_nothing(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), _import(rec))
    [result] = await push(client, auth_headers("user_a"), _import(rec, T1, label="Renamed"))
    assert result["status"] == "applied"
    assert result["row"]["label"] == "Renamed"
    assert result["row"]["state"] == "processing"
    assert await _job_kinds(verify_session, rec) == ["import"]


async def test_an_own_recording_pushed_again_as_an_import_queues_nothing(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(client, auth_headers("user_a"), _import(rec, T1))
    assert result["status"] == "applied"
    assert result["row"]["state"] == "pending_upload"
    assert await _origin_fields(verify_session, rec) == ("microphone", "own", None)
    assert await _job_kinds(verify_session, rec) == []


async def test_an_update_keeps_an_imports_provenance(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), _import(rec))
    [result] = await push(client, auth_headers("user_a"), recording(rec, T1, label="Renamed"))
    assert result["status"] == "applied"
    assert result["row"]["label"] == "Renamed"
    assert (result["row"]["source"], result["row"]["origin"], result["row"]["origin_url"]) == (
        "import",
        "slippery_hill",
        TUNE_PAGE,
    )
    assert await _origin_fields(verify_session, rec) == ("import", "slippery_hill", TUNE_PAGE)
    assert await _job_kinds(verify_session, rec) == ["import"]


async def test_a_stale_push_of_an_import_queues_nothing(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, T1))
    [result] = await push(client, auth_headers("user_a"), _import(rec, T0))
    assert result["status"] == "stale"
    assert result["row"]["state"] == "pending_upload"
    assert await _job_kinds(verify_session, rec) == []


async def test_deleting_an_unknown_import_creates_nothing(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    [result] = await push(
        client, auth_headers("user_a"), change("recordings", rec, T0, op="delete")
    )
    assert result["status"] == "invalid"
    assert await verify_session.get(Recording, uuid.UUID(rec)) is None
    assert await _job_kinds(verify_session, rec) == []


async def test_two_imports_from_one_page_each_queue_a_job(
    client, auth_headers, verify_session
) -> None:
    first, second = uid(), uid()
    results = await push(client, auth_headers("user_a"), _import(first), _import(second))
    assert [r["row"]["state"] for r in results] == ["processing", "processing"]
    assert await _job_kinds(verify_session, first) == ["import"]
    assert await _job_kinds(verify_session, second) == ["import"]
