"""Recordings sync like every other table, with server-owned columns a client cannot write."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import delete, select, update

from crosstune.db.base import utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.jobs.sweep import queue_ready_splits
from crosstune.models import Job, Recording, RecordingLoop
from crosstune.sync import rules
from crosstune.vocabulary import (
    LIMITS,
    PLACE_ACCURACY_M_MAX,
    SPLIT_FULL,
    SPLIT_MISMATCH,
    SPLIT_UNNAMED,
)
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


async def test_push_cannot_write_storage_keys(client, auth_headers) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec, playback_key="x"))
    assert result["status"] == "invalid"
    assert "invalid fields" in result["reason"]


async def test_push_ignores_server_owned_row_keys(client, auth_headers, verify_session) -> None:
    # A client that keeps unknown pulled fields echoes them back; the push still applies.
    rec, split = uid(), uid()
    echoed = {
        "state": "ready",
        "duration_ms": 1,
        "playback_mime": "audio/mp4",
        "playback_bytes": 1,
        "error": "x",
        "source_duration_ms": 1,
        "playback_start_ms": 0,
        "playback_end_ms": 1,
        "playback_rev": "r",
        "peaks_rev": "p",
        "split_completed_id": split,
        "user_id": str(uuid.uuid4()),
        "server_seq": 99,
    }
    [result] = await push(client, auth_headers("user_a"), recording(rec, label="A", **echoed))
    assert result["status"] == "applied"
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    assert stored is not None
    assert stored.label == "A"
    assert stored.state == "pending_upload"
    assert stored.duration_ms is None
    assert stored.error is None
    assert stored.split_completed_id is None
    assert result["row"]["split_completed_id"] is None


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


async def test_push_trim_on_piece_clamps_to_slice(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(
            state="ready",
            source_offset_ms=5_000,
            source_duration_ms=15_000,
        )
    )
    await verify_session.commit()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, trim_start_ms=0, trim_end_ms=15_000)
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (5_000, 15_000)


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
    assert [r["table"] for r in body["rows"]] == ["entitlements", "recordings"]


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
    fields = {"recorded_at": None, "recorded_precision": None, **data}
    return recording(rec, at, source="import", origin="slippery_hill", origin_url=page, **fields)


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


async def test_push_of_an_import_for_an_account_with_no_room_fails_it_without_a_fetch(
    app, client, auth_headers, verify_session
) -> None:
    app.state.settings = app.state.settings.model_copy(update={"trial_quota_bytes": 0})
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), _import(rec))
    assert result["status"] == "applied"
    assert (result["row"]["state"], result["row"]["error"]) == ("failed", "Storage quota exceeded")
    assert await _job_kinds(verify_session, rec) == []


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


@pytest.mark.parametrize(
    ("recorded_at", "precision"),
    [(None, "year"), (T0.isoformat(), None)],
    ids=["precision-without-date", "date-without-precision"],
)
async def test_push_refuses_a_recorded_date_without_its_precision(
    client, auth_headers, verify_session, recorded_at, precision
) -> None:
    rec = uid()
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, recorded_at=recorded_at, recorded_precision=precision),
    )
    assert result["status"] == "invalid"
    assert result["reason"] == "invalid fields: recorded_at"
    assert await verify_session.get(Recording, uuid.UUID(rec)) is None


@pytest.mark.parametrize("precision", ["year", "month", "day"])
async def test_push_refuses_a_partial_recorded_date_more_than_a_day_ahead(
    client, auth_headers, precision
) -> None:
    ahead = (utc_now() + timedelta(days=2)).replace(hour=0, minute=0, second=0, microsecond=0)
    ahead = ahead.replace(year=ahead.year + 1, month=1, day=1)
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(uid(), recorded_at=ahead.isoformat(), recorded_precision=precision),
    )
    assert result["status"] == "invalid"
    assert result["reason"] == "invalid fields: recorded_at"


async def test_push_accepts_a_captured_time_more_than_a_day_ahead(client, auth_headers) -> None:
    """A capture from a device whose clock runs fast must still sync."""
    ahead = utc_now() + timedelta(days=2)
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(uid(), recorded_at=ahead.isoformat(), recorded_precision="time"),
    )
    assert result["status"] == "applied"


async def test_push_accepts_a_recorded_date_within_a_day_of_now(client, auth_headers) -> None:
    """A device clock running ahead, or a zone east of UTC, still saves today's date."""
    ahead = utc_now() + timedelta(hours=23)
    [result] = await push(
        client, auth_headers("user_a"), recording(uid(), recorded_at=ahead.isoformat())
    )
    assert result["status"] == "applied"


async def test_an_upload_has_no_recorded_date(client, auth_headers) -> None:
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(uid(), source="upload", recorded_at=None, recorded_precision=None),
    )
    assert result["status"] == "applied"
    assert (result["row"]["recorded_at"], result["row"]["recorded_precision"]) == (None, None)


async def test_push_refuses_a_recording_without_a_date_added(client, auth_headers) -> None:
    body = recording(uid())
    del body["data"]["added_at"]
    [result] = await push(client, auth_headers("user_a"), body)
    assert result["status"] == "invalid"
    assert result["reason"] == "invalid fields: added_at"


async def test_a_partial_recorded_date_round_trips_through_pull(client, auth_headers) -> None:
    rec = uid()
    year = datetime(1937, 1, 1, tzinfo=UTC)
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, source="upload", recorded_at=year.isoformat(), recorded_precision="year"),
    )
    rows = (await pull(client, auth_headers("user_a")))["rows"]
    [row] = [r["row"] for r in rows if r["table"] == "recordings"]
    assert row["id"] == rec
    assert datetime.fromisoformat(row["recorded_at"]) == year
    assert row["recorded_precision"] == "year"
    assert datetime.fromisoformat(row["added_at"]) == T0


async def test_an_update_keeps_the_date_added(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, added_at=T2.isoformat(), label="x")
    )
    assert result["status"] == "applied"
    assert result["row"]["label"] == "x"
    assert datetime.fromisoformat(result["row"]["added_at"]) == T0
    stored = await verify_session.get(Recording, uuid.UUID(rec))
    assert stored.added_at == T0


async def test_an_update_can_change_and_clear_the_recorded_date(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    month = datetime(1998, 5, 1, tzinfo=UTC)
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T1, recorded_at=month.isoformat(), recorded_precision="month"),
    )
    assert datetime.fromisoformat(result["row"]["recorded_at"]) == month
    assert result["row"]["recorded_precision"] == "month"
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T2, recorded_at=None, recorded_precision=None),
    )
    assert (result["row"]["recorded_at"], result["row"]["recorded_precision"]) == (None, None)


@pytest.mark.parametrize(
    ("precision", "recorded_at"),
    [
        ("year", "1937-01-01T00:00:00Z"),
        ("month", "1998-05-01T00:00:00Z"),
        ("day", "1998-10-03T00:00:00Z"),
        ("day", "1998-10-03T02:00:00+02:00"),
        ("time", "1998-10-03T16:12:34.5Z"),
    ],
    ids=["year", "month", "day", "day-offset-at-utc-midnight", "time"],
)
async def test_push_accepts_a_date_at_the_start_of_its_period(
    client, auth_headers, precision: str, recorded_at: str
) -> None:
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(uid(), recorded_at=recorded_at, recorded_precision=precision),
    )
    assert result["status"] == "applied"
    assert result["row"]["recorded_precision"] == precision


@pytest.mark.parametrize(
    ("precision", "recorded_at"),
    [
        ("year", "1937-05-01T00:00:00Z"),
        ("year", "1937-01-01T00:00:01Z"),
        ("month", "1998-05-02T00:00:00Z"),
        ("month", "1998-05-01T00:00:00.001Z"),
        ("day", "2026-10-02T22:00:00Z"),
        ("day", "1998-10-03T00:00:00+02:00"),
    ],
    ids=[
        "year-mid-year",
        "year-past-midnight",
        "month-mid-month",
        "month-past-midnight",
        "day-local-midnight-east-of-utc",
        "day-offset-off-utc-midnight",
    ],
)
async def test_push_refuses_a_partial_date_off_the_start_of_its_period(
    client, auth_headers, verify_session, precision: str, recorded_at: str
) -> None:
    rec = uid()
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, recorded_at=recorded_at, recorded_precision=precision),
    )
    assert result["status"] == "invalid"
    assert result["reason"] == "invalid fields: recorded_at"
    assert await verify_session.get(Recording, uuid.UUID(rec)) is None


async def test_push_stores_notes_players_and_place(client, auth_headers) -> None:
    rec = uid()
    fields = {
        "notes": "Joe's kitchen",
        "players": "Kevin and Ed",
        "place_name": "Galax, VA",
        "place_lat": 36.66,
        "place_lon": -80.92,
    }
    [result] = await push(client, auth_headers("user_a"), recording(rec, **fields))
    assert result["status"] == "applied"
    rows = (await pull(client, auth_headers("user_a")))["rows"]
    [row] = [r["row"] for r in rows if r["table"] == "recordings"]
    assert {key: row[key] for key in fields} == fields


async def test_push_keeps_full_precision(client, auth_headers) -> None:
    rec = uid()
    fields = {"place_lat": 36.661234, "place_lon": -80.923912, "place_accuracy_m": 12}
    await push(client, auth_headers("user_a"), recording(rec, **fields))
    rows = (await pull(client, auth_headers("user_a")))["rows"]
    [row] = [r["row"] for r in rows if r["table"] == "recordings"]
    assert {key: row[key] for key in fields} == fields


async def test_push_keeps_coordinates_without_a_name(client, auth_headers) -> None:
    rec = uid()
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, place_lat=36.66, place_lon=-80.92)
    )
    assert result["status"] == "applied"
    assert result["row"]["place_name"] is None
    rows = (await pull(client, auth_headers("user_a")))["rows"]
    [row] = [r["row"] for r in rows if r["table"] == "recordings"]
    assert (row["place_lat"], row["place_lon"], row["place_name"]) == (36.66, -80.92, None)


async def test_push_takes_the_widest_accuracy(client, auth_headers) -> None:
    fields = {"place_lat": 1.0, "place_lon": 1.0, "place_accuracy_m": PLACE_ACCURACY_M_MAX}
    [result] = await push(client, auth_headers("user_a"), recording(uid(), **fields))
    assert result["status"] == "applied"


@pytest.mark.parametrize(
    ("fields", "field"),
    [
        ({"place_accuracy_m": 5}, "place_accuracy_m"),
        ({"place_lat": 1.0, "place_lon": 1.0, "place_accuracy_m": -1}, "place_accuracy_m"),
        ({"place_lat": 36.66}, "place_lon"),
        ({"place_lon": -80.92}, "place_lon"),
        ({"place_name": "Galax, VA"}, "place_name"),
        ({"place_lat": 91, "place_lon": 0}, "place_lat"),
        ({"place_lat": 0, "place_lon": -181}, "place_lon"),
        ({"players": "x" * 201}, "players"),
        ({"players": ""}, "players"),
        ({"players": " \n "}, "players"),
        ({"place_lat": 1.0, "place_lon": 1.0, "place_name": ""}, "place_name"),
        ({"place_lat": 1.0, "place_lon": 1.0, "place_name": "  "}, "place_name"),
        (
            {"place_lat": 1.0, "place_lon": 1.0, "place_accuracy_m": PLACE_ACCURACY_M_MAX + 1},
            "place_accuracy_m",
        ),
        ({"notes": "x" * (LIMITS["recordings"]["notes"] + 1)}, "notes"),
    ],
)
async def test_push_refuses_an_invalid_place_or_players(
    client, auth_headers, fields: dict, field: str
) -> None:
    [result] = await push(client, auth_headers("user_a"), recording(uid(), **fields))
    assert result["status"] == "invalid"
    assert result["reason"] == f"invalid fields: {field}"


async def _place_jobs(verify_session, rec: str) -> int:
    return len([kind for kind in await _job_kinds(verify_session, rec) if kind == "place"])


async def test_push_with_unnamed_coordinates_queues_one_place_job(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    place = {"place_lat": 36.6612, "place_lon": -80.9239}
    await push(client, auth_headers("user_a"), recording(rec, **place))
    assert await _place_jobs(verify_session, rec) == 1
    await push(client, auth_headers("user_a"), recording(rec, T1, label="Again", **place))
    assert await _place_jobs(verify_session, rec) == 1


async def test_push_with_a_named_place_queues_no_job(client, auth_headers, verify_session) -> None:
    rec = uid()
    place = {"place_lat": 36.6612, "place_lon": -80.9239, "place_name": "Galax, VA"}
    await push(client, auth_headers("user_a"), recording(rec, **place))
    assert await _place_jobs(verify_session, rec) == 0


async def test_push_without_a_place_queues_no_job(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    assert await _place_jobs(verify_session, rec) == 0


async def test_push_piece_keeps_split_columns(client, auth_headers) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    await push(client, headers, recording(parent, T1, split_id=split, split_size=2))
    [result] = await push(
        client, headers, recording(piece, split_from_id=parent, created_by_split_id=split)
    )
    assert result["status"] == "applied"
    rows = {
        r["row"]["id"]: r["row"]
        for r in (await pull(client, headers))["rows"]
        if r["table"] == "recordings"
    }
    assert set(rows) == {parent, piece}
    assert (rows[parent]["split_id"], rows[parent]["split_size"]) == (split, 2)
    assert rows[parent]["created_by_split_id"] is None
    assert rows[piece]["split_from_id"] == parent
    assert rows[piece]["created_by_split_id"] == split
    assert (rows[piece]["split_id"], rows[piece]["split_size"]) == (None, None)
    assert "source_offset_ms" not in rows[piece]
    assert rows[parent]["split_completed_id"] is None


async def test_split_from_id_and_created_by_split_id_are_insert_only(client, auth_headers) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    await push(client, headers, recording(piece, split_from_id=parent, created_by_split_id=split))
    await push(client, headers, recording(piece, T1, split_from_id=None, created_by_split_id=uid()))
    rows = {
        r["row"]["id"]: r["row"]
        for r in (await pull(client, headers))["rows"]
        if r["table"] == "recordings"
    }
    assert rows[piece]["split_from_id"] == parent
    assert rows[piece]["created_by_split_id"] == split


async def test_piece_without_created_by_split_id_is_refused(client, auth_headers) -> None:
    parent, piece = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    [result] = await push(client, headers, recording(piece, T1, split_from_id=parent))
    assert result["status"] == "invalid"
    assert result["reason"] == SPLIT_UNNAMED


async def test_piece_of_another_users_recording_is_refused(client, auth_headers) -> None:
    parent, piece = uid(), uid()
    await push(client, auth_headers("user_b"), recording(parent))
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(piece, split_from_id=parent, created_by_split_id=uid()),
    )
    assert result["status"] == "invalid"
    assert result["reason"] == "split_from_id does not reference one of your recordings"


async def test_piece_of_a_soft_deleted_parent_is_accepted(client, auth_headers) -> None:
    parent, piece = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    await push(client, headers, change("recordings", parent, T1, op="delete"))
    [result] = await push(
        client, headers, recording(piece, T2, split_from_id=parent, created_by_split_id=uid())
    )
    assert result["status"] == "applied"


async def test_recording_of_a_soft_deleted_tune_is_still_refused(client, auth_headers) -> None:
    tune, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, change("tunes", tune, T0, title="Angeline"))
    await push(client, headers, change("tunes", tune, T1, op="delete"))
    [result] = await push(client, headers, recording(rec, T2, tune_id=tune))
    assert result["status"] == "invalid"
    assert "tune_id" in result["reason"]


@pytest.mark.parametrize("size", [1, 51])
async def test_push_refuses_a_split_size_out_of_range(client, auth_headers, size) -> None:
    [result] = await push(client, auth_headers("user_a"), recording(uid(), split_size=size))
    assert result["status"] == "invalid"


async def _ready_parent(client, headers, verify_session, parent: str, **values) -> None:
    await push(client, headers, recording(parent))
    fields = {
        "state": "ready",
        "playback_start_ms": 0,
        "playback_end_ms": 180_000,
        "source_duration_ms": 180_000,
    }
    fields.update(values)
    await verify_session.execute(update(Recording).where(Recording.id == parent).values(**fields))
    await verify_session.commit()


async def _piece_state(verify_session, piece: str) -> str:
    verify_session.expire_all()
    return await verify_session.scalar(select(Recording.state).where(Recording.id == piece))


async def test_new_piece_is_processing_and_queues_split_on_ready_parent(
    client, auth_headers, verify_session
) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    [result] = await push(
        client, headers, recording(piece, T1, split_from_id=parent, created_by_split_id=split)
    )
    assert result["status"] == "applied"
    assert result["row"]["state"] == "processing"
    assert await _job_kinds(verify_session, parent) == ["split"]


async def test_new_piece_waits_when_parent_not_ready(client, auth_headers, verify_session) -> None:
    parent, piece = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    await push(
        client, headers, recording(piece, T1, split_from_id=parent, created_by_split_id=uid())
    )
    assert await _piece_state(verify_session, piece) == "processing"
    assert await _job_kinds(verify_session, parent) == []


async def test_piece_trim_clamps_to_parent_source_not_playback(
    client, auth_headers, verify_session
) -> None:
    parent, piece = uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(
        client,
        headers,
        verify_session,
        parent,
        trim_start_ms=0,
        trim_end_ms=60_000,
        playback_end_ms=60_000,
    )
    [result] = await push(
        client,
        headers,
        recording(
            piece,
            T1,
            split_from_id=parent,
            created_by_split_id=uid(),
            trim_start_ms=60_000,
            trim_end_ms=120_000,
        ),
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (60_000, 120_000)


async def test_piece_from_another_split_is_refused(client, auth_headers, verify_session) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    [result] = await push(
        client,
        headers,
        recording(piece, T1, split_from_id=parent, created_by_split_id=uid()),
    )
    assert result["status"] == "invalid"
    assert result["reason"] == SPLIT_MISMATCH


async def test_piece_is_accepted_before_the_parent_carries_a_split_id(client, auth_headers) -> None:
    parent, piece = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    [result] = await push(
        client, headers, recording(piece, T1, split_from_id=parent, created_by_split_id=uid())
    )
    assert result["status"] == "applied"


async def test_parent_trim_job_held_while_a_piece_is_processing(
    client, auth_headers, verify_session
) -> None:
    parent, split = uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    await push(
        client, headers, recording(uid(), T1, split_from_id=parent, created_by_split_id=split)
    )
    await push(
        client,
        headers,
        recording(parent, T2, split_id=split, split_size=2, trim_start_ms=500, trim_end_ms=1500),
    )
    assert await _job_kinds(verify_session, parent) == ["split"]


async def test_parent_trim_job_runs_when_no_piece_is_processing(
    client, auth_headers, verify_session
) -> None:
    parent, split = uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    await push(
        client,
        headers,
        recording(parent, T1, split_id=split, split_size=2, trim_start_ms=500, trim_end_ms=1500),
    )
    assert await _job_kinds(verify_session, parent) == ["trim"]


async def test_piece_of_a_failed_parent_fails_with_its_error(
    client, auth_headers, verify_session
) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(
        client,
        headers,
        verify_session,
        parent,
        state="failed",
        error="The audio could not be read",
        split_id=split,
        split_size=2,
    )
    [result] = await push(
        client, headers, recording(piece, T1, split_from_id=parent, created_by_split_id=split)
    )
    assert result["status"] == "applied"
    assert (result["row"]["state"], result["row"]["error"]) == (
        "failed",
        "The audio could not be read",
    )
    assert await _job_kinds(verify_session, parent) == []


async def test_tune_delete_that_removes_a_piece_lets_the_sweep_queue_its_parent_split_job(
    client, auth_headers, verify_session, engine
) -> None:
    parent, piece, split, tune = uid(), uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, change("tunes", tune, T0, title="Angeline"))
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    await push(
        client,
        headers,
        recording(piece, T1, split_from_id=parent, created_by_split_id=split, tune_id=tune),
    )
    await verify_session.execute(delete(Job).where(Job.recording_id == uuid.UUID(parent)))
    await verify_session.commit()

    [result] = await push(client, headers, change("tunes", tune, T2, op="delete"))
    assert result["status"] == "applied"
    assert await _piece_state(verify_session, piece) == "processing"
    assert await queue_ready_splits(make_sessionmaker(engine)) == 1
    assert await _job_kinds(verify_session, parent) == ["split"]
    assert await queue_ready_splits(make_sessionmaker(engine)) == 0


async def test_tune_delete_unfiles_a_held_parent_and_keeps_its_loops(
    client, auth_headers, verify_session
) -> None:
    parent, piece, other, loop, split, tune = uid(), uid(), uid(), uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, change("tunes", tune, T0, title="Angeline"))
    await _ready_parent(
        client, headers, verify_session, parent, split_id=split, split_size=2, tune_id=tune
    )
    await push(
        client,
        headers,
        recording(piece, T1, split_from_id=parent, created_by_split_id=split),
        recording(other, T1, tune_id=tune),
        change(
            "recording_loops",
            loop,
            T1,
            recording_id=parent,
            label="B part",
            start_ms=1000,
            end_ms=5000,
            color=2,
        ),
    )

    [result] = await push(client, headers, change("tunes", tune, T2, op="delete"))
    assert result["status"] == "applied"
    verify_session.expire_all()
    kept = await verify_session.get(Recording, uuid.UUID(parent))
    assert (kept.deleted_at, kept.tune_id, kept.updated_at) == (None, None, T2)
    assert (await verify_session.get(RecordingLoop, uuid.UUID(loop))).deleted_at is None
    assert (await verify_session.get(Recording, uuid.UUID(other))).deleted_at == T2
    assert await _piece_state(verify_session, piece) == "processing"
    [row] = [
        r["row"]
        for r in (await pull(client, headers))["rows"]
        if r["table"] == "recordings" and r["row"]["id"] == parent
    ]
    assert (row["deleted_at"], row["tune_id"]) == (None, None)


async def test_piece_beyond_its_split_size_is_refused(client, auth_headers, verify_session) -> None:
    parent, split = uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    [first] = await push(
        client, headers, recording(uid(), T1, split_from_id=parent, created_by_split_id=split)
    )
    [extra] = await push(
        client, headers, recording(uid(), T1, split_from_id=parent, created_by_split_id=split)
    )
    assert first["status"] == "applied"
    assert extra["status"] == "invalid"
    assert extra["reason"] == SPLIT_FULL


async def _split_parent(client, headers, verify_session) -> tuple[str, str]:
    """A ready parent narrowed to [1_000, 60_000] by a split whose one piece starts at 60_000."""
    parent, split = uid(), uid()
    await _ready_parent(
        client,
        headers,
        verify_session,
        parent,
        split_id=split,
        split_size=2,
        trim_start_ms=1_000,
        trim_end_ms=60_000,
    )
    await push(
        client,
        headers,
        recording(
            uid(),
            T1,
            split_from_id=parent,
            created_by_split_id=split,
            trim_start_ms=60_000,
            trim_end_ms=180_000,
        ),
    )
    return parent, split


async def test_push_without_split_columns_keeps_the_stored_split_and_trim(
    client, auth_headers, verify_session
) -> None:
    headers = auth_headers("user_a")
    parent, split = await _split_parent(client, headers, verify_session)
    [result] = await push(client, headers, recording(parent, T2, label="Renamed"))
    assert result["status"] == "applied"
    row = result["row"]
    assert row["label"] == "Renamed"
    assert (row["split_id"], row["split_size"]) == (split, 2)
    assert (row["trim_start_ms"], row["trim_end_ms"]) == (1_000, 60_000)


async def test_push_never_widens_a_split_parent_past_its_pieces(
    client, auth_headers, verify_session
) -> None:
    headers = auth_headers("user_a")
    parent, split = await _split_parent(client, headers, verify_session)
    [result] = await push(
        client,
        headers,
        recording(parent, T2, split_id=split, split_size=2, trim_start_ms=0, trim_end_ms=120_000),
    )
    assert result["status"] == "applied"
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (1_000, 60_000)


async def test_push_may_narrow_a_split_parent(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    parent, split = await _split_parent(client, headers, verify_session)
    [result] = await push(
        client,
        headers,
        recording(
            parent, T2, split_id=split, split_size=2, trim_start_ms=5_000, trim_end_ms=50_000
        ),
    )
    assert (result["row"]["trim_start_ms"], result["row"]["trim_end_ms"]) == (5_000, 50_000)


async def test_push_with_a_new_split_id_applies_the_new_split(
    client, auth_headers, verify_session
) -> None:
    headers = auth_headers("user_a")
    parent, _ = await _split_parent(client, headers, verify_session)
    again = uid()
    [result] = await push(
        client,
        headers,
        recording(
            parent, T2, split_id=again, split_size=3, trim_start_ms=1_000, trim_end_ms=20_000
        ),
    )
    assert result["status"] == "applied"
    row = result["row"]
    assert (row["split_id"], row["split_size"]) == (again, 3)
    assert (row["trim_start_ms"], row["trim_end_ms"]) == (1_000, 20_000)


async def test_piece_before_its_parents_split_waits_then_queues_the_split(
    client, auth_headers, verify_session
) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent)
    [result] = await push(
        client,
        headers,
        recording(
            piece,
            T1,
            split_from_id=parent,
            created_by_split_id=split,
            trim_start_ms=60_000,
            trim_end_ms=180_000,
        ),
    )
    assert result["status"] == "applied"
    assert await _piece_state(verify_session, piece) == "processing"
    assert await _job_kinds(verify_session, parent) == []

    await push(
        client,
        headers,
        recording(parent, T2, split_id=split, split_size=2, trim_end_ms=60_000),
    )
    assert await _piece_state(verify_session, piece) == "processing"
    assert await _job_kinds(verify_session, parent) == ["split"]


async def test_piece_before_its_parents_split_is_held_to_the_most_pieces(
    client, auth_headers, verify_session, monkeypatch
) -> None:
    monkeypatch.setattr(rules, "MAX_SPLIT_PIECES", 3)
    parent, split = uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent)
    results = [
        (
            await push(
                client,
                headers,
                recording(uid(), T1, split_from_id=parent, created_by_split_id=split),
            )
        )[0]
        for _ in range(3)
    ]
    assert [r["status"] for r in results] == ["applied", "applied", "invalid"]
    assert results[2]["reason"] == SPLIT_FULL
    # Another split's pieces count on their own.
    [other] = await push(
        client, headers, recording(uid(), T1, split_from_id=parent, created_by_split_id=uid())
    )
    assert other["status"] == "applied"


async def test_deleting_a_failed_piece_lets_the_sweep_queue_the_parent_split_job(
    client, auth_headers, verify_session, engine
) -> None:
    parent, piece, split = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await _ready_parent(client, headers, verify_session, parent, split_id=split, split_size=2)
    await push(
        client, headers, recording(piece, T1, split_from_id=parent, created_by_split_id=split)
    )
    await verify_session.execute(delete(Job).where(Job.recording_id == uuid.UUID(parent)))
    await verify_session.execute(
        update(Recording).where(Recording.id == uuid.UUID(piece)).values(state="failed")
    )
    await verify_session.commit()
    assert await _job_kinds(verify_session, parent) == []

    [result] = await push(client, headers, change("recordings", piece, T2, op="delete"))
    assert result["status"] == "applied"
    assert await queue_ready_splits(make_sessionmaker(engine)) == 1
    assert await _job_kinds(verify_session, parent) == ["split"]


async def test_pull_returns_split_completion_and_push_cannot_write_it(
    client, auth_headers, verify_session
) -> None:
    parent, split = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(parent))
    await push(client, headers, recording(parent, T1, split_id=split, split_size=2))
    [ignored] = await push(client, headers, recording(parent, T2, split_completed_id=split))
    assert ignored["status"] == "applied"
    assert ignored["row"]["split_completed_id"] is None
    await verify_session.execute(
        update(Recording).where(Recording.id == parent).values(split_completed_id=split)
    )
    await verify_session.commit()
    [row] = [
        r["row"]
        for r in (await pull(client, headers))["rows"]
        if r["table"] == "recordings" and r["row"]["id"] == parent
    ]
    assert row["split_completed_id"] == split
