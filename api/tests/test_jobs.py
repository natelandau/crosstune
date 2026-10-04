"""The transcode job and the runner around it."""

from __future__ import annotations

import asyncio
import logging
import re
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.engine import make_sessionmaker
from crosstune.files.quota import slot_for_recording
from crosstune.jobs import peaks_job as peaks_job_module
from crosstune.jobs import runner as runner_module
from crosstune.jobs import sweep as sweep_module
from crosstune.jobs import transcode as transcode_module
from crosstune.jobs import trim as trim_module
from crosstune.jobs.media import probe
from crosstune.jobs.peaks import decode_peaks
from crosstune.jobs.peaks_job import build_recording_peaks
from crosstune.jobs.runner import ABANDONED_SLOT_GRACE, MAX_ATTEMPTS, JobRunner
from crosstune.jobs.transcode import transcode
from crosstune.jobs.trim import trim
from crosstune.models import Job, Recording, RecordingLoop, UploadSlot, User
from crosstune.models.user import new_uuid7, utc_now
from crosstune.recordings.service import enqueue_job, ensure_trim_job
from crosstune.storage.prefixed import PrefixedStore
from crosstune.storage.store import (
    new_rev,
    original_key,
    peaks_key,
    playback_key,
    recording_prefix,
    upload_key,
)
from crosstune.vocabulary import JobKind
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy import ScalarResult

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

# A fixed revision for fabricated keys in tests that only care about the recording prefix.
REV = "aaaaaaaa"


async def make_user(session) -> User:
    user = User(id=new_uuid7(), clerk_user_id=f"user_{uuid.uuid4().hex[:8]}")
    session.add(user)
    await session.flush()
    return user


async def add_recording(session, user: User, state: str, **fields) -> Recording:
    rec = Recording(
        id=new_uuid7(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        state=state,
        **fields,
    )
    session.add(rec)
    await session.flush()
    return rec


async def make_uploaded(
    session, store: FakeObjectStore, user: User, path, content_type: str
) -> Recording:
    rec = await add_recording(session, user, "uploaded", playback_bytes=path.stat().st_size)
    store.put_bytes(upload_key(user.id, rec.id), path.read_bytes(), content_type)
    return rec


async def test_transcode_passes_an_aac_upload_through(session, media_fixtures, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    assert rec.state == "ready"
    assert rec.playback_key == playback_key(user.id, rec.id, rec.playback_rev)
    assert rec.playback_mime == "audio/mp4"
    assert rec.playback_bytes == len(store.get_bytes(rec.playback_key))
    assert rec.original_key is None
    assert 1_900 <= rec.duration_ms <= 2_100
    # The upload survives transcode(); the runner deletes it once the row is committed.
    assert sorted(store.keys()) == sorted(
        [rec.playback_key, rec.peaks_key, upload_key(user.id, rec.id)]
    )


async def test_transcode_writes_revisioned_playback(session, media_fixtures, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    assert re.fullmatch(r"[0-9a-f]{8}", rec.playback_rev)
    assert rec.playback_key == playback_key(user.id, rec.id, rec.playback_rev)
    assert store.get_bytes(rec.playback_key)


async def test_transcode_sets_ranges_and_peaks(session, media_fixtures, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    assert rec.playback_start_ms == 0
    assert rec.playback_end_ms == rec.source_duration_ms
    assert re.fullmatch(r"[0-9a-f]{8}", rec.peaks_rev)
    assert rec.peaks_key == peaks_key(user.id, rec.id, rec.peaks_rev)
    points = decode_peaks(store.get_bytes(rec.peaks_key))
    assert 90 <= len(points) <= 110


async def test_transcode_applies_trim_saved_before_upload(
    session, media_fixtures, tmp_path
) -> None:
    """A fixture that needs encoding, so the cut runs on the raw upload, not a full remux."""
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["wav"], "audio/wav")
    rec.trim_start_ms = 500
    rec.trim_end_ms = 1500
    await transcode(session, store, rec, tmp_path)
    assert 970 <= rec.duration_ms <= 1030
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)


async def test_transcode_passthrough_trim_keeps_full_original(
    session, media_fixtures, tmp_path
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    rec.trim_start_ms = 500
    rec.trim_end_ms = 1500
    await transcode(session, store, rec, tmp_path)
    assert rec.original_key is not None
    original_path = tmp_path / "original_check"
    original_path.write_bytes(store.get_bytes(rec.original_key))
    original_info = await probe(original_path)
    assert 1_900 <= original_info.duration_ms <= 2_100
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)


async def test_transcode_keeps_an_existing_original_on_a_no_cut_retry(
    session, media_fixtures, tmp_path
) -> None:
    """A passthrough attempt that no longer needs a cut must not orphan a prior backup."""
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    existing = original_key(user.id, rec.id, "audio/mp4")
    store.put_bytes(existing, b"a prior full backup", "audio/mp4")
    rec.original_key = existing
    rec.original_bytes = 20
    await transcode(session, store, rec, tmp_path)
    assert rec.original_key == existing
    assert rec.original_bytes == 20
    assert store.get_bytes(existing) == b"a prior full backup"


async def test_one_pending_trim_job(session) -> None:
    user = await make_user(session)
    rec = await add_recording(session, user, "ready")
    first = await enqueue_job(session, rec, JobKind.TRIM)
    second = await enqueue_job(session, rec, JobKind.TRIM)
    assert first is not None
    assert second is None
    rows = list(await session.scalars(select(Job).where(Job.recording_id == rec.id)))
    assert len(rows) == 1


async def test_peaks_job_backfills(session, media_fixtures, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    await session.refresh(rec)
    seq_before = rec.server_seq
    rec.peaks_key = None
    rec.peaks_rev = None
    rec.peaks_bytes = None
    await session.flush()
    backfill_dir = tmp_path / "backfill"
    backfill_dir.mkdir()
    await build_recording_peaks(session, store, rec, backfill_dir)
    await session.refresh(rec)
    assert rec.peaks_rev is not None
    assert rec.peaks_key == peaks_key(user.id, rec.id, rec.peaks_rev)
    assert store.get_bytes(rec.peaks_key)
    assert rec.state == "ready"
    assert rec.server_seq > seq_before


async def test_peaks_job_measures_a_recording_with_no_length(
    session, media_fixtures, tmp_path
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    await session.refresh(rec)
    rec.duration_ms = None
    rec.source_duration_ms = None
    rec.playback_end_ms = None
    rec.trim_end_ms = 99_000
    await session.flush()
    backfill_dir = tmp_path / "backfill"
    backfill_dir.mkdir()
    await build_recording_peaks(session, store, rec, backfill_dir)
    await session.refresh(rec)
    assert 1_900 <= rec.source_duration_ms <= 2_100
    assert rec.duration_ms == rec.source_duration_ms
    assert (rec.playback_start_ms, rec.playback_end_ms) == (0, rec.source_duration_ms)
    # A trim saved while the length was unknown is clamped to the length now known.
    assert rec.trim_end_ms == rec.source_duration_ms


async def test_peaks_job_keeps_a_known_length(
    session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    await session.refresh(rec)
    known = (rec.duration_ms, rec.source_duration_ms, rec.playback_start_ms, rec.playback_end_ms)

    probed: list[object] = []

    async def record_probe(path) -> None:
        probed.append(path)

    monkeypatch.setattr(peaks_job_module, "probe", record_probe)
    backfill_dir = tmp_path / "backfill"
    backfill_dir.mkdir()
    await build_recording_peaks(session, store, rec, backfill_dir)
    await session.refresh(rec)
    assert probed == []
    assert (
        rec.duration_ms,
        rec.source_duration_ms,
        rec.playback_start_ms,
        rec.playback_end_ms,
    ) == known


@pytest.mark.parametrize(
    ("fixture", "content_type", "extension"),
    [("webm", "audio/webm", "webm"), ("wav", "audio/wav", "wav"), ("mp3", "audio/mpeg", "mp3")],
)
async def test_transcode_encodes_and_keeps_the_original(
    session, media_fixtures, tmp_path, fixture: str, content_type: str, extension: str
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures[fixture], content_type)
    await transcode(session, store, rec, tmp_path)
    assert rec.state == "ready"
    assert rec.original_key == original_key(user.id, rec.id, content_type)
    assert rec.original_key.endswith(f".{extension}")
    assert rec.original_bytes == media_fixtures[fixture].stat().st_size
    assert sorted(store.keys()) == sorted(
        [rec.playback_key, rec.peaks_key, rec.original_key, upload_key(user.id, rec.id)]
    )


async def test_transcode_raises_on_junk_and_leaves_the_upload(session, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    junk = tmp_path / "junk"
    junk.write_bytes(b"nope")
    rec = await make_uploaded(session, store, user, junk, "audio/mp4")
    with pytest.raises(Exception, match=r"ffprobe|audio"):
        await transcode(session, store, rec, tmp_path)
    assert store.keys() == [upload_key(user.id, rec.id)]


class _DeleteFailsStore(FakeObjectStore):
    """An ObjectStore whose delete always fails, to exercise the bounded-leak path."""

    async def delete(self, *keys: str) -> None:
        msg = "delete failed"
        raise RuntimeError(msg)


@pytest.fixture
def runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, FakeObjectStore]:
    store = FakeObjectStore()
    return JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings), store


async def seed(verify_session, store: FakeObjectStore, path, content_type: str) -> Recording:
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, path, content_type)
    verify_session.add(Job(recording_id=rec.id, user_id=user.id))
    await verify_session.commit()
    return rec


async def test_run_once_transcodes_one_job_and_removes_it(
    runner, verify_session, media_fixtures
) -> None:
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    before_seq = rec.server_seq
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert rec.server_seq > before_seq
    assert upload_key(rec.user_id, rec.id) not in set(store.keys())
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None
    assert await job_runner.run_once() == 0


async def test_run_once_leaves_no_trim_job_after_applying_a_pre_upload_trim(
    runner, verify_session, media_fixtures
) -> None:
    """transcode() never queues jobs itself; only the runner's ensure_trim_job call can."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, media_fixtures["m4a"], "audio/mp4")
    rec.trim_start_ms = 500
    rec.trim_end_ms = 1500
    verify_session.add(Job(recording_id=rec.id, user_id=user.id))
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)
    trims = await verify_session.scalar(
        select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.TRIM.value)
    )
    assert trims is None


async def test_run_once_preserves_a_trim_pushed_during_the_job(
    runner, verify_session, engine, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A trim saved while the transcode runs must survive the job's own commit."""
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    real_build_peaks = transcode_module.build_peaks

    async def push_trim_then_build(source) -> bytes:
        sessionmaker = make_sessionmaker(engine)
        async with sessionmaker() as pusher:
            pushed = await pusher.get(Recording, rec.id)
            pushed.trim_start_ms = 200
            pushed.trim_end_ms = 1800
            await pusher.commit()
        return await real_build_peaks(source)

    monkeypatch.setattr(transcode_module, "build_peaks", push_trim_then_build)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.trim_start_ms, rec.trim_end_ms) == (200, 1800)
    trims = list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.TRIM.value)
        )
    )
    assert len(trims) == 1


async def test_run_once_deletes_a_superseded_playback_and_peaks_revision(
    runner, verify_session, media_fixtures
) -> None:
    """A re-transcode that lands a new revision must not leave the old one behind."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, media_fixtures["m4a"], "audio/mp4")
    stale_playback = playback_key(user.id, rec.id, new_rev())
    stale_peaks = peaks_key(user.id, rec.id, new_rev())
    store.put_bytes(stale_playback, b"an old revision", "audio/mp4")
    store.put_bytes(stale_peaks, b"an old peaks file", "application/octet-stream")
    rec.playback_key = stale_playback
    rec.peaks_key = stale_peaks
    verify_session.add(Job(recording_id=rec.id, user_id=user.id))
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.playback_key != stale_playback
    assert rec.peaks_key != stale_peaks
    assert stale_playback not in set(store.keys())
    assert stale_peaks not in set(store.keys())
    assert rec.playback_key in set(store.keys())
    assert rec.peaks_key in set(store.keys())


async def test_run_once_survives_a_transcode_failure_after_the_transaction_began(
    runner, verify_session, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure once lock_user has issued SQL must not crash reading expired attributes.

    lock_user runs last, after the playback and peaks objects are already uploaded,
    so this also covers the failure path deleting what this attempt orphaned.
    """
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    before_keys = set(store.keys())
    real_lock_user = transcode_module.lock_user
    uploaded: set[str] = set()

    async def lock_then_fail(session, user_id) -> None:
        uploaded.update(set(store.keys()) - before_keys)
        await real_lock_user(session, user_id)
        msg = "boom after the lock"
        raise RuntimeError(msg)

    monkeypatch.setattr(transcode_module, "lock_user", lock_then_fail)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "uploaded"
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    assert job is not None
    assert job.attempts == 1
    # The attempt really did upload a playback and a peaks object before failing.
    assert len(uploaded) == 2
    assert not (uploaded & set(store.keys()))


async def test_run_once_leaves_a_recording_ready_when_deleting_the_upload_fails(
    engine, verify_session, media_fixtures, tmp_path, settings: Settings
) -> None:
    store = _DeleteFailsStore()
    job_runner = JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings)
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert upload_key(rec.user_id, rec.id) in set(store.keys())


async def test_run_once_gives_up_after_max_attempts(runner, verify_session, tmp_path) -> None:
    job_runner, store = runner
    junk = tmp_path / "junk"
    junk.write_bytes(b"nope")
    rec = await seed(verify_session, store, junk, "audio/mp4")
    # populate_existing forces each iteration to see the runner's own commits instead of
    # verify_session's identity-mapped copy from the previous fetch.
    stmt = select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    for _ in range(MAX_ATTEMPTS):
        job = await verify_session.scalar(stmt)
        job.locked_until = None
        await verify_session.commit()
        await job_runner.run_once()
    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "The audio could not be read"
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def seed_ready_for_peaks(
    verify_session, store: FakeObjectStore, media_fixtures, tmp_path
) -> Recording:
    """A ready recording, already transcoded, with its peaks columns cleared and a job queued."""
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(verify_session, store, rec, tmp_path)
    rec.peaks_key = None
    rec.peaks_rev = None
    rec.peaks_bytes = None
    verify_session.add(Job(recording_id=rec.id, user_id=user.id, kind=JobKind.PEAKS.value))
    await verify_session.commit()
    # transcode() bumps server_seq through a SQL expression, which leaves it expired.
    await verify_session.refresh(rec)
    return rec


async def test_run_once_dispatches_a_peaks_job(
    runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    seq_before = rec.server_seq
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert rec.peaks_rev is not None
    assert rec.server_seq > seq_before
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def test_run_once_preserves_a_trim_pushed_during_a_peaks_job(
    runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A trim saved while a peaks job runs must still reach ensure_trim_job's comparison."""
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    real_build_peaks = peaks_job_module.build_peaks

    async def push_trim_then_build(source) -> bytes:
        sessionmaker = make_sessionmaker(engine)
        async with sessionmaker() as pusher:
            pushed = await pusher.get(Recording, rec.id)
            pushed.trim_start_ms = 200
            pushed.trim_end_ms = 1800
            await pusher.commit()
        return await real_build_peaks(source)

    monkeypatch.setattr(peaks_job_module, "build_peaks", push_trim_then_build)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.trim_start_ms, rec.trim_end_ms) == (200, 1800)
    trims = list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.TRIM.value)
        )
    )
    assert len(trims) == 1


async def test_run_once_queues_a_trim_saved_before_a_recording_was_measured(
    runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    rec.duration_ms = None
    rec.source_duration_ms = None
    rec.playback_end_ms = None
    rec.trim_start_ms = 200
    rec.trim_end_ms = 1800
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.playback_end_ms is not None
    trims = list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.TRIM.value)
        )
    )
    assert len(trims) == 1


async def test_peaks_job_gives_up_after_max_attempts_leaves_row_untouched(
    runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    playback = (rec.playback_key, rec.playback_rev, rec.playback_start_ms, rec.playback_end_ms)
    # Corrupt the stored playback object so every attempt to build peaks fails.
    store.put_bytes(rec.playback_key, b"not audio", "audio/mp4")
    stmt = select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    for _ in range(MAX_ATTEMPTS):
        job = await verify_session.scalar(stmt)
        job.locked_until = None
        await verify_session.commit()
        await job_runner.run_once()
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert rec.error is None
    assert rec.peaks_rev is None
    # Everything the download route needs is untouched, so the recording still plays.
    assert (rec.playback_key, rec.playback_rev, rec.playback_start_ms, rec.playback_end_ms) == (
        playback
    )
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def test_run_once_survives_a_peaks_failure_after_the_transaction_began(
    runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure once the lock has issued SQL must not crash reading expired attributes.

    lock_user runs after the peaks object is already uploaded, so this also covers
    build_recording_peaks deleting what this attempt orphaned.
    """
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    before_keys = set(store.keys())
    real_lock_user = peaks_job_module.lock_user
    uploaded: set[str] = set()

    async def lock_then_fail(session, user_id) -> None:
        uploaded.update(set(store.keys()) - before_keys)
        await real_lock_user(session, user_id)
        msg = "boom after the lock"
        raise RuntimeError(msg)

    monkeypatch.setattr(peaks_job_module, "lock_user", lock_then_fail)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.peaks_rev is None
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    assert job is not None
    assert job.attempts == 1
    # The attempt really did upload a peaks object before failing.
    assert len(uploaded) == 1
    assert not (uploaded & set(store.keys()))


async def test_peaks_job_aborts_when_playback_changes_during_the_job(
    session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Peaks built for a playback file superseded mid-job must never attach to the row."""
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    rec.peaks_key = None
    rec.peaks_rev = None
    rec.peaks_bytes = None
    await session.flush()
    real_build_peaks = peaks_job_module.build_peaks

    async def build_then_supersede(source) -> bytes:
        data = await real_build_peaks(source)
        rec.playback_key = playback_key(user.id, rec.id, new_rev())
        await session.flush()
        return data

    monkeypatch.setattr(peaks_job_module, "build_peaks", build_then_supersede)
    backfill_dir = tmp_path / "abort"
    backfill_dir.mkdir()
    keys_before = set(store.keys())
    await build_recording_peaks(session, store, rec, backfill_dir)
    assert rec.peaks_key is None
    assert rec.peaks_rev is None
    assert set(store.keys()) == keys_before


async def test_run_once_drops_a_peaks_job_with_no_playback_file(runner, verify_session) -> None:
    job_runner, _ = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "pending_upload")
    verify_session.add(Job(recording_id=rec.id, user_id=user.id, kind=JobKind.PEAKS.value))
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def test_run_job_drops_a_job_of_unknown_kind(runner, verify_session) -> None:
    job_runner, _ = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "ready")
    job = Job(recording_id=rec.id, user_id=user.id, kind=JobKind.TRANSCODE.value)
    verify_session.add(job)
    await verify_session.commit()
    fake = Job(id=job.id, recording_id=rec.id, user_id=user.id, kind="bogus", locked_until=None)
    await job_runner._run_job(fake)
    assert await verify_session.scalar(select(Job).where(Job.id == job.id)) is None


async def test_run_once_skips_a_locked_job(runner, verify_session, media_fixtures) -> None:
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    job.locked_until = datetime(2999, 1, 1, tzinfo=UTC)
    await verify_session.commit()
    assert await job_runner.run_once() == 0


async def test_run_once_purges_deleted_recordings(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    rec_id = uuid.uuid4()
    rec = Recording(
        id=rec_id,
        user_id=user.id,
        source="microphone",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now(),
        state="ready",
        playback_key=playback_key(user.id, rec_id, new_rev()),
        playback_bytes=3,
        original_key=original_key(user.id, rec_id, "audio/webm"),
        original_bytes=3,
        error="boom",
    )
    verify_session.add(rec)
    await verify_session.commit()
    before_seq = rec.server_seq
    store.put_bytes(rec.playback_key, b"abc", "audio/mp4")
    store.put_bytes(rec.original_key, b"abc", "audio/webm")
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_key, rec.original_key, rec.playback_bytes, rec.original_bytes) == (
        None,
        None,
        None,
        None,
    )
    assert rec.state == "pending_upload"
    assert rec.error is None
    assert rec.server_seq > before_seq
    assert store.keys() == []
    assert await job_runner.run_once() == 0


async def test_run_once_purges_an_upload_deleted_before_it_transcoded(
    runner, verify_session
) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = Recording(
        id=uuid.uuid4(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now(),
        state="uploaded",
        playback_bytes=3,
    )
    verify_session.add(rec)
    await verify_session.commit()
    store.put_bytes(upload_key(user.id, rec.id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await job_runner.run_once() == 0


async def test_run_once_purges_an_upload_deleted_before_it_was_confirmed(
    runner, verify_session
) -> None:
    """A PUT can land after the row is deleted; only the open slot says the object may exist."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = Recording(
        id=uuid.uuid4(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now(),
        state="pending_upload",
    )
    verify_session.add(rec)
    await verify_session.flush()
    verify_session.add(
        UploadSlot(
            recording_id=rec.id,
            user_id=user.id,
            declared_bytes=3,
            content_type="audio/mp4",
            expires_at=utc_now() - ABANDONED_SLOT_GRACE - timedelta(minutes=1),
        )
    )
    await verify_session.commit()
    store.put_bytes(upload_key(user.id, rec.id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_recording(verify_session, rec.id) is None
    assert await job_runner.run_once() == 0


async def test_run_once_collects_an_upload_that_lands_after_the_purge(
    runner, verify_session
) -> None:
    """A PUT signed before the delete can land after the purge; the kept slot brings it back."""
    job_runner, store = runner
    rec = await _pending_with_slot(verify_session, expired_for=-timedelta(minutes=5))
    rec.state = "uploaded"
    rec.playback_bytes = 3
    rec.deleted_at = utc_now()
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    assert await slot_for_recording(verify_session, rec.id) is not None
    assert await job_runner.run_once() == 0
    store.put_bytes(upload_key(rec.user_id, rec.id), b"abc", "audio/mp4")
    slot = await slot_for_recording(verify_session, rec.id)
    slot.expires_at = utc_now() - ABANDONED_SLOT_GRACE - timedelta(minutes=1)
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_recording(verify_session, rec.id) is None
    assert await job_runner.run_once() == 0


async def _pending_with_slot(
    verify_session, *, expired_for: timedelta, playback_bytes: int | None = None
) -> Recording:
    user = await make_user(verify_session)
    rec = Recording(
        id=uuid.uuid4(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        state="pending_upload",
        playback_bytes=playback_bytes,
    )
    verify_session.add(rec)
    await verify_session.flush()
    verify_session.add(
        UploadSlot(
            recording_id=rec.id,
            user_id=user.id,
            declared_bytes=3,
            content_type="audio/mp4",
            expires_at=utc_now() - expired_for,
        )
    )
    await verify_session.commit()
    return rec


async def test_run_once_releases_a_slot_abandoned_past_the_grace(runner, verify_session) -> None:
    """An expired slot stops counting, so what its PUT left must not stay in the bucket."""
    job_runner, store = runner
    rec = await _pending_with_slot(
        verify_session, expired_for=ABANDONED_SLOT_GRACE + timedelta(minutes=1), playback_bytes=3
    )
    seq_before = rec.server_seq
    store.put_bytes(upload_key(rec.user_id, rec.id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_recording(verify_session, rec.id) is None
    await verify_session.refresh(rec)
    assert (rec.state, rec.playback_bytes, rec.deleted_at) == ("pending_upload", None, None)
    assert rec.server_seq > seq_before
    assert await job_runner.run_once() == 0


async def test_release_leaves_a_recording_confirmed_under_a_reissued_slot(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A slot reissued and confirmed while the bucket delete runs keeps its counted bytes."""
    job_runner, store = runner
    rec = await _pending_with_slot(
        verify_session, expired_for=ABANDONED_SLOT_GRACE + timedelta(minutes=1), playback_bytes=3
    )
    delete_objects = store.delete

    async def reissue_and_confirm(*keys: str) -> None:
        await delete_objects(*keys)
        slot = await slot_for_recording(verify_session, rec.id)
        assert slot is not None
        slot.expires_at = utc_now() + timedelta(hours=1)
        rec.state = "uploaded"
        rec.playback_bytes = 7
        await verify_session.commit()

    monkeypatch.setattr(store, "delete", reissue_and_confirm)
    assert await sweep_module.release_abandoned_slots(job_runner._sessionmaker, store) == 0
    await verify_session.refresh(rec)
    assert (rec.state, rec.playback_bytes) == ("uploaded", 7)
    assert await slot_for_recording(verify_session, rec.id) is not None


async def test_run_once_keeps_a_slot_inside_the_grace(runner, verify_session) -> None:
    """A PUT signed just before expiry may still be on its way."""
    job_runner, store = runner
    rec = await _pending_with_slot(verify_session, expired_for=timedelta(minutes=5))
    store.put_bytes(upload_key(rec.user_id, rec.id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 0
    assert store.keys() == [upload_key(rec.user_id, rec.id)]
    assert await slot_for_recording(verify_session, rec.id) is not None


async def test_purge_leaves_a_recording_undeleted_and_uploaded_meanwhile(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rows are re-read under the locks, so a recording live again keeps its new upload."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "ready", deleted_at=utc_now(), playback_bytes=3)
    rec.playback_key = playback_key(user.id, rec.id, REV)
    await verify_session.commit()
    store.put_bytes(rec.playback_key, b"abc", "audio/mp4")
    scalars = AsyncSession.scalars
    planted = False

    async def undelete_and_upload_after_first_read(
        session, *args, **kwargs
    ) -> ScalarResult[Recording]:
        nonlocal planted
        result = await scalars(session, *args, **kwargs)
        if not planted and session is not verify_session:
            # Lands after the purge picked its candidates and before it touches the bucket.
            planted = True
            rec.deleted_at = None
            rec.playback_key = None
            rec.state = "uploaded"
            rec.playback_bytes = 7
            await verify_session.commit()
            store.put_bytes(upload_key(user.id, rec.id), b"abcdefg", "audio/mp4")
        return result

    monkeypatch.setattr(AsyncSession, "scalars", undelete_and_upload_after_first_read)
    seq_before = rec.server_seq
    assert await sweep_module.purge_deleted(job_runner._sessionmaker, store) == 0
    assert planted
    assert store.get_bytes(upload_key(user.id, rec.id)) == b"abcdefg"
    await verify_session.refresh(rec)
    assert (rec.state, rec.playback_bytes) == ("uploaded", 7)
    assert rec.server_seq == seq_before


async def test_run_once_purges_objects_the_row_never_named(runner, verify_session) -> None:
    """A transcode that copied the original and then failed before committing leaves no key."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = Recording(
        id=uuid.uuid4(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now(),
        state="failed",
        playback_bytes=3,
    )
    verify_session.add(rec)
    await verify_session.commit()
    store.put_bytes(upload_key(user.id, rec.id), b"abc", "audio/webm")
    store.put_bytes(original_key(user.id, rec.id, "audio/webm"), b"abc", "audio/webm")
    other_id = uuid.uuid4()
    other_rev = new_rev()
    verify_session.add(
        Recording(
            id=other_id,
            user_id=user.id,
            source="upload",
            recorded_at=utc_now(),
            created_at=utc_now(),
            updated_at=utc_now(),
            state="ready",
            playback_key=playback_key(user.id, other_id, other_rev),
            playback_bytes=3,
        )
    )
    await verify_session.commit()
    store.put_bytes(playback_key(user.id, other_id, other_rev), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == [playback_key(user.id, other_id, other_rev)]


async def test_sweep_orphans_removes_prefixes_with_no_user(runner, verify_session) -> None:
    """A UUID prefix with no user row is garbage; anything else in the bucket is left alone."""
    job_runner, store = runner
    user = await make_user(verify_session)
    await verify_session.commit()
    gone = new_uuid7()
    store.put_bytes(playback_key(user.id, "r1", REV), b"a", "audio/mp4")
    store.put_bytes(playback_key(gone, "r1", REV), b"b", "audio/mp4")
    store.put_bytes(upload_key(gone, "r2"), b"c", "audio/mp4")
    store.put_bytes("not-a-user/r1/playback.m4a", b"d", "audio/mp4")
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == sorted(["not-a-user/r1/playback.m4a", playback_key(user.id, "r1", REV)])
    assert await job_runner.sweep_orphans() == 0


async def test_run_once_sweeps_orphans_once_per_interval(
    engine, tmp_path, settings: Settings
) -> None:
    store = FakeObjectStore()
    hourly = JobRunner(
        make_sessionmaker(engine), store, orphan_sweep_seconds=3600, settings=settings
    )
    first = new_uuid7()
    store.put_bytes(playback_key(first, "r1", REV), b"a", "audio/mp4")
    assert await hourly.run_once() == 1
    second = new_uuid7()
    store.put_bytes(playback_key(second, "r1", REV), b"b", "audio/mp4")
    assert await hourly.run_once() == 0
    assert store.keys() == [playback_key(second, "r1", REV)]
    always = JobRunner(make_sessionmaker(engine), store, orphan_sweep_seconds=0, settings=settings)
    assert await always.run_once() == 1
    assert store.keys() == []


async def test_sweep_removes_recording_prefixes_with_no_row(runner, verify_session) -> None:
    """A recording prefix with no row under a live user is garbage, like a user prefix with no user."""
    job_runner, store = runner
    user = await make_user(verify_session)
    kept = await add_recording(verify_session, user, "ready")
    await verify_session.commit()
    stray = uuid.uuid4()
    store.put_bytes(playback_key(user.id, kept.id, REV), b"a", "audio/mp4")
    store.put_bytes(playback_key(user.id, stray, REV), b"b", "audio/mp4")
    store.put_bytes(upload_key(user.id, stray), b"c", "audio/mp4")
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == [playback_key(user.id, kept.id, REV)]


async def test_sweep_keeps_recordings_with_a_row_in_any_state(runner, verify_session) -> None:
    """Only a UUID recording prefix with no row goes; a purged row still claims its prefix."""
    job_runner, store = runner
    user = await make_user(verify_session)
    states = ["pending_upload", "uploaded", "processing", "ready", "failed"]
    recs = [await add_recording(verify_session, user, state) for state in states]
    # What _purge leaves behind: soft-deleted, keys cleared, ready to upload again.
    purged = await add_recording(verify_session, user, "pending_upload")
    purged.deleted_at = utc_now()
    await verify_session.commit()
    for rec in recs:
        store.put_bytes(playback_key(user.id, rec.id, REV), b"a", "audio/mp4")
    store.put_bytes(upload_key(user.id, purged.id), b"a", "audio/mp4")
    store.put_bytes(f"{user.id}/not-a-uuid/x", b"a", "audio/mp4")
    stray = new_uuid7()
    store.put_bytes(upload_key(user.id, stray), b"a", "audio/mp4")
    kept = sorted(
        [playback_key(user.id, rec.id, REV) for rec in recs]
        + [upload_key(user.id, purged.id), f"{user.id}/not-a-uuid/x"]
    )
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == kept
    assert await job_runner.sweep_orphans() == 0


async def test_sweep_removes_old_revisions_a_live_row_does_not_name(runner, verify_session) -> None:
    """Files an attempt uploaded but never committed go once no attempt could still name them."""
    job_runner, store = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "ready")
    rec.playback_key = playback_key(user.id, rec.id, "live")
    rec.peaks_key = peaks_key(user.id, rec.id, "live")
    await verify_session.commit()
    named = [rec.playback_key, rec.peaks_key]
    strays = [playback_key(user.id, rec.id, "gone"), peaks_key(user.id, rec.id, "gone")]
    rewritten_in_place = [upload_key(user.id, rec.id), original_key(user.id, rec.id, "audio/mp4")]
    for key in [*named, *strays, *rewritten_in_place]:
        store.put_bytes(key, b"a", "audio/mp4")
        store.age(key, runner_module.STRAY_REVISION_AGE + timedelta(minutes=1))
    # Young enough that an attempt still running could yet commit it.
    in_flight = playback_key(user.id, rec.id, "new")
    store.put_bytes(in_flight, b"a", "audio/mp4")
    assert await job_runner.sweep_orphans() == 2
    assert store.keys() == sorted([*named, *rewritten_in_place, in_flight])
    assert await job_runner.sweep_orphans() == 0


def test_a_claim_outlasts_the_longest_attempt() -> None:
    assert runner_module.LOCK_SECONDS > runner_module.ATTEMPT_TIMEOUT_SECONDS
    assert runner_module.STRAY_REVISION_AGE.total_seconds() > runner_module.LOCK_SECONDS


async def test_a_job_cancelled_at_shutdown_goes_back_uncounted_and_cleans_up(
    runner, verify_session, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    monkeypatch.setattr(runner_module, "STOP_TIMEOUT_SECONDS", 0.1)
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    uploaded = playback_key(rec.user_id, rec.id, "cut")
    started = asyncio.Event()

    async def upload_then_hang(_session, _store, recording, _work_dir) -> None:
        store.put_bytes(uploaded, b"a", "audio/mp4")
        recording.playback_key = uploaded
        started.set()
        await asyncio.sleep(60)

    monkeypatch.setattr(runner_module, "transcode", upload_then_hang)
    job_runner.start()
    await asyncio.wait_for(started.wait(), timeout=5)
    await asyncio.wait_for(job_runner.stop(), timeout=10)
    job = await verify_session.scalar(
        select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    )
    assert job is not None
    assert job.locked_until is None
    assert job.attempts == 0
    assert await store.head(uploaded) is None


async def test_an_attempt_past_its_time_limit_fails_and_backs_off(
    runner, verify_session, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    monkeypatch.setattr(runner_module, "ATTEMPT_TIMEOUT_SECONDS", 0.1)

    async def hang(*_args: object) -> None:
        await asyncio.sleep(60)

    monkeypatch.setattr(runner_module, "transcode", hang)
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    await asyncio.wait_for(job_runner.run_once(), timeout=10)
    await verify_session.refresh(rec)
    assert rec.state == "uploaded"
    job = await verify_session.scalar(
        select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    )
    assert job is not None
    assert job.attempts == 1
    assert job.locked_until is not None
    assert job.locked_until > utc_now()


async def test_peaks_cancelled_after_its_upload_deletes_the_object(
    runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    before_keys = set(store.keys())
    uploaded: set[str] = set()

    async def hang_at_the_lock(_session, _user_id) -> None:
        uploaded.update(set(store.keys()) - before_keys)
        await asyncio.sleep(60)

    monkeypatch.setattr(peaks_job_module, "lock_user", hang_at_the_lock)
    task = asyncio.create_task(job_runner.run_once())
    for _ in range(500):
        if uploaded:
            break
        await asyncio.sleep(0.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert len(uploaded) == 1
    assert not (uploaded & set(store.keys()))
    job = await verify_session.scalar(
        select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    )
    assert job is not None
    assert job.attempts == 0


async def test_sweep_through_a_prefix_leaves_other_environments_alone(
    engine, verify_session, settings: Settings
) -> None:
    """A pr-N sweep sees only pr-N/, never a sibling preview or the unprefixed keys beside it."""
    user_a = await make_user(verify_session)
    rec_a = await add_recording(verify_session, user_a, "ready")
    await verify_session.commit()
    user_b, rec_b = new_uuid7(), new_uuid7()
    bucket = FakeObjectStore()
    a_keys = [
        f"pr-6/{playback_key(user_a.id, rec_a.id, REV)}",
        f"pr-6/{upload_key(user_a.id, rec_a.id)}",
    ]
    others = [
        f"pr-7/{playback_key(user_b, rec_b, REV)}",
        playback_key(new_uuid7(), new_uuid7(), REV),
    ]
    for key in a_keys + others:
        bucket.put_bytes(key, b"a", "audio/mp4")
    job_runner = JobRunner(
        make_sessionmaker(engine), PrefixedStore(bucket, "pr-6/"), settings=settings
    )
    assert await job_runner.sweep_orphans() == 0
    assert bucket.keys() == sorted(a_keys + others)
    stray = f"pr-6/{playback_key(new_uuid7(), new_uuid7(), REV)}"
    bucket.put_bytes(stray, b"a", "audio/mp4")
    assert await job_runner.sweep_orphans() == 1
    assert bucket.keys() == sorted(a_keys + others)


class _RecordingDeletesStore(FakeObjectStore):
    """Records each prefix delete instead of scanning, so a huge sweep stays fast."""

    def __init__(self) -> None:
        super().__init__()
        self.deleted: list[str] = []

    async def delete_prefix(self, prefix: str) -> None:
        self.deleted.append(prefix)


async def test_sweep_handles_more_ids_than_postgres_bind_parameters(
    engine, verify_session, settings: Settings
) -> None:
    """Postgres drivers cap bind parameters at 32767, so each id set must bind as one."""
    user = await make_user(verify_session)
    kept = await add_recording(verify_session, user, "ready")
    await verify_session.commit()
    store = _RecordingDeletesStore()
    store.put_bytes(playback_key(user.id, kept.id, REV), b"a", "audio/mp4")
    expected = []
    for _ in range(33_000):
        stray, gone = new_uuid7(), new_uuid7()
        store.put_bytes(playback_key(user.id, stray, REV), b"b", "audio/mp4")
        store.put_bytes(playback_key(gone, new_uuid7(), REV), b"c", "audio/mp4")
        expected += [f"{user.id}/{stray}/", f"{gone}/"]
    job_runner = JobRunner(make_sessionmaker(engine), store, settings=settings)
    assert await job_runner.sweep_orphans() == len(expected)
    assert sorted(store.deleted) == sorted(expected)


async def test_sweep_removes_a_recording_filed_under_the_wrong_user(runner, verify_session) -> None:
    job_runner, store = runner
    owner = await make_user(verify_session)
    other = await make_user(verify_session)
    rec = await add_recording(verify_session, owner, "ready")
    await verify_session.commit()
    store.put_bytes(playback_key(other.id, rec.id, REV), b"a", "audio/mp4")
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == []


async def test_start_and_stop(runner) -> None:
    job_runner, _ = runner
    task = job_runner.start()
    await job_runner.stop()
    assert task.done()


async def test_stop_gives_up_on_a_job_that_will_not_finish(runner, monkeypatch) -> None:
    job_runner, _ = runner
    monkeypatch.setattr("crosstune.jobs.runner.STOP_TIMEOUT_SECONDS", 0.1)
    started = asyncio.Event()

    async def _run_once() -> int:
        started.set()
        await asyncio.sleep(60)
        return 0

    job_runner.run_once = _run_once
    task = job_runner.start()
    await asyncio.wait_for(started.wait(), timeout=2)
    await asyncio.wait_for(job_runner.stop(), timeout=5)
    assert task.done()


async def test_run_forever_survives_a_crash_and_sleeps_only_when_idle(runner, monkeypatch) -> None:
    job_runner, _ = runner
    monkeypatch.setattr("crosstune.jobs.runner.ERROR_RETRY_SECONDS", 0.01)
    mock_run_once = AsyncMock(side_effect=[RuntimeError("boom"), 1, 0, 0])
    job_runner.next_due = AsyncMock(return_value=utc_now() + timedelta(hours=1))
    idle = asyncio.Event()

    async def _run_once() -> int:
        worked = await mock_run_once()
        if worked == 0:
            idle.set()
        return worked

    job_runner.run_once = _run_once
    task = job_runner.start()
    await asyncio.wait_for(idle.wait(), timeout=2)
    await asyncio.sleep(0.05)
    assert mock_run_once.await_count == 3
    await job_runner.stop()
    assert task.done()


async def _idle_runner(job_runner: JobRunner) -> None:
    """Start the loop and wait until its first idle wait has begun."""
    idle = asyncio.Event()
    real_next_due = job_runner.next_due

    async def _next_due() -> datetime:
        due = await real_next_due()
        idle.set()
        return due

    job_runner.next_due = _next_due
    job_runner.start()
    await asyncio.wait_for(idle.wait(), timeout=5)


async def test_next_due_is_the_orphan_sweep_when_nothing_is_pending(runner) -> None:
    job_runner, _ = runner
    await job_runner.run_once()
    due = await job_runner.next_due()
    assert abs(due - (utc_now() + timedelta(hours=1))) < timedelta(seconds=1)


async def test_next_due_is_a_backed_off_job(runner, verify_session) -> None:
    job_runner, _ = runner
    await job_runner.run_once()
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "uploaded")
    locked_until = utc_now() + timedelta(seconds=45)
    verify_session.add(Job(recording_id=rec.id, user_id=user.id, locked_until=locked_until))
    await verify_session.commit()
    assert await job_runner.next_due() == locked_until


async def test_next_due_is_an_abandoned_slot_past_grace(runner, verify_session) -> None:
    job_runner, _ = runner
    await job_runner.run_once()
    # Past expiry but inside the grace, so it comes due before the hourly sweep.
    rec = await _pending_with_slot(verify_session, expired_for=timedelta(seconds=10))
    slot = await slot_for_recording(verify_session, rec.id)
    confirmed = await _pending_with_slot(verify_session, expired_for=timedelta(seconds=20))
    confirmed.state = "uploaded"
    await verify_session.commit()
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_next_due_is_a_deleted_rows_slot_past_grace(runner, verify_session) -> None:
    """A purge keeps a deleted row's slot until no PUT can land, then must run again."""
    job_runner, _ = runner
    await job_runner.run_once()
    deleted = await _pending_with_slot(verify_session, expired_for=timedelta(seconds=10))
    deleted.deleted_at = utc_now()
    await verify_session.commit()
    slot = await slot_for_recording(verify_session, deleted.id)
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_wake_runs_work_that_arrived_while_idle(runner, verify_session) -> None:
    job_runner, store = runner
    await _idle_runner(job_runner)
    user = await make_user(verify_session)
    rec_id = uuid.uuid4()
    rec = Recording(
        id=rec_id,
        user_id=user.id,
        source="microphone",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        deleted_at=utc_now(),
        state="ready",
        playback_key=playback_key(user.id, rec_id, new_rev()),
        playback_bytes=3,
    )
    verify_session.add(rec)
    await verify_session.commit()
    store.put_bytes(rec.playback_key, b"abc", "audio/mp4")
    purged = asyncio.Event()
    real_run_once = job_runner.run_once

    async def _run_once() -> int:
        worked = await real_run_once()
        if worked:
            purged.set()
        return worked

    job_runner.run_once = _run_once
    job_runner.wake()
    await asyncio.wait_for(purged.wait(), timeout=5)
    assert store.keys() == []
    await verify_session.refresh(rec)
    assert rec.playback_key is None
    await job_runner.stop()


async def test_wake_during_a_pass_is_not_lost(runner) -> None:
    job_runner, _ = runner
    calls = 0
    second_pass = asyncio.Event()

    async def _run_once() -> int:
        nonlocal calls
        calls += 1
        if calls == 1:
            job_runner.wake()
        else:
            second_pass.set()
        return 0

    job_runner.run_once = _run_once
    job_runner.start()
    await asyncio.wait_for(second_pass.wait(), timeout=2)
    await job_runner.stop()


async def test_stop_interrupts_a_long_sleep(runner) -> None:
    job_runner, _ = runner
    await _idle_runner(job_runner)
    task = job_runner.task
    await asyncio.wait_for(job_runner.stop(), timeout=1)
    assert task.done()


async def test_next_due_failure_waits_and_continues(runner, monkeypatch) -> None:
    job_runner, _ = runner
    monkeypatch.setattr("crosstune.jobs.runner.ERROR_RETRY_SECONDS", 0.05)
    calls = 0
    second_call = asyncio.Event()

    async def _next_due() -> datetime:
        nonlocal calls
        calls += 1
        if calls == 1:
            msg = "database down"
            raise RuntimeError(msg)
        second_call.set()
        return utc_now() + timedelta(hours=1)

    job_runner.next_due = _next_due
    task = job_runner.start()
    await asyncio.wait_for(second_call.wait(), timeout=2)
    assert not task.done()
    await job_runner.stop()


class _WriteTrackingStore(FakeObjectStore):
    """Records every key a job writes, so a test can prove a job wrote nothing."""

    def __init__(self) -> None:
        super().__init__()
        self.written: list[str] = []
        self.fail_uploads = False

    async def upload(self, path, key: str, content_type: str) -> int:
        if self.fail_uploads:
            msg = "upload failed"
            raise RuntimeError(msg)
        self.written.append(key)
        return await super().upload(path, key, content_type)

    async def copy(self, source: str, target: str) -> None:
        self.written.append(target)
        await super().copy(source, target)


@pytest.fixture
def trim_runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, _WriteTrackingStore]:
    store = _WriteTrackingStore()
    return JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings), store


async def seed_ready(verify_session, store: FakeObjectStore, path, content_type, tmp_path):
    """A recording transcoded to ready over its full source, with no job queued."""
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, path, content_type)
    work = tmp_path / f"seed-{rec.id}"
    work.mkdir()
    await transcode(verify_session, store, rec, work)
    await store.delete(upload_key(user.id, rec.id))
    await verify_session.commit()
    await verify_session.refresh(rec)
    if isinstance(store, _WriteTrackingStore):
        store.written.clear()
    return rec


async def save_trim(verify_session, rec: Recording, start_ms: int, end_ms: int | None) -> None:
    """What a push that changes the trim leaves behind: the new trim and one trim job."""
    rec.trim_start_ms = start_ms
    rec.trim_end_ms = end_ms
    await enqueue_job(verify_session, rec, JobKind.TRIM)
    await verify_session.commit()


async def trim_jobs(verify_session, rec: Recording) -> list[Job]:
    return list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.TRIM.value)
        )
    )


async def probe_key(store: FakeObjectStore, key: str, tmp_path) -> int:
    path = tmp_path / f"probe-{uuid.uuid4().hex}"
    path.write_bytes(store.get_bytes(key))
    return (await probe(path)).duration_ms


async def test_trim_cuts_from_original(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    assert rec.original_key is None
    old_playback, old_peaks, old_rev = rec.playback_key, rec.peaks_key, rec.playback_rev
    old_bytes = rec.playback_bytes
    full_audio = store.get_bytes(old_playback)
    seq_before = rec.server_seq
    await save_trim(verify_session, rec, 500, 1500)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert abs(rec.duration_ms - 1000) <= 30
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)
    assert rec.playback_rev != old_rev
    assert rec.playback_key == playback_key(rec.user_id, rec.id, rec.playback_rev)
    assert old_playback not in set(store.keys())
    assert old_peaks not in set(store.keys())
    assert rec.playback_key in set(store.keys())
    assert rec.peaks_key in set(store.keys())
    assert rec.playback_bytes < old_bytes
    assert rec.server_seq > seq_before
    # The playback file was the only full copy, so it became the original, byte for byte.
    assert rec.original_key == original_key(rec.user_id, rec.id, "audio/mp4")
    assert store.get_bytes(rec.original_key) == full_audio
    assert rec.original_bytes == len(full_audio)
    assert abs(await probe_key(store, rec.original_key, tmp_path) - 2000) <= 100
    # A kept second at 50 points per second, sliced from the full peaks file.
    assert abs(len(decode_peaks(store.get_bytes(rec.peaks_key))) - 50) <= 1
    assert await trim_jobs(verify_session, rec) == []


async def test_second_trim_narrows_from_original(
    trim_runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 200, 1800)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    original = store.get_bytes(rec.original_key)
    first_peaks = decode_peaks(store.get_bytes(rec.peaks_key))

    cut_sources: list[bytes] = []
    real_cut = trim_module.cut

    async def recording_cut(source, target, start_ms, end_ms) -> None:
        cut_sources.append(source.read_bytes())
        await real_cut(source, target, start_ms, end_ms)

    monkeypatch.setattr(trim_module, "cut", recording_cut)
    await save_trim(verify_session, rec, 500, 1500)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert abs(rec.duration_ms - 1000) <= 30
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)
    assert cut_sources == [original]
    assert store.get_bytes(rec.original_key) == original
    # 500-1500 ms of the source is 300-1300 ms into the first cut's peaks, which
    # start at 200 ms; 50 points per second puts that at points 15 to 65.
    assert decode_peaks(store.get_bytes(rec.peaks_key)) == first_peaks[15:65]


async def test_trim_start_only_with_null_end(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, None)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, rec.source_duration_ms)
    assert rec.trim_end_ms is None
    assert abs(rec.duration_ms - (rec.source_duration_ms - 500)) <= 30
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_keeps_an_existing_original(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    """An upload that was re-encoded already has its raw original; the trim never replaces it."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["wav"], "audio/wav", tmp_path)
    kept_key, kept = rec.original_key, store.get_bytes(rec.original_key)
    await save_trim(verify_session, rec, 500, 1500)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.original_key == kept_key
    assert store.get_bytes(kept_key) == kept
    assert kept_key not in store.written
    assert abs(rec.duration_ms - 1000) <= 30


async def test_trim_failure_keeps_ready(
    trim_runner, verify_session, media_fixtures, tmp_path, caplog: pytest.LogCaptureFixture
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old_playback, old_peaks = rec.playback_key, rec.peaks_key
    keys_before = set(store.keys())
    old_state = (rec.playback_rev, rec.playback_start_ms, rec.playback_end_ms, rec.duration_ms)
    await save_trim(verify_session, rec, 500, 1500)
    store.fail_uploads = True
    stmt = select(Job).where(Job.recording_id == rec.id).execution_options(populate_existing=True)
    for _ in range(MAX_ATTEMPTS):
        job = await verify_session.scalar(stmt)
        assert job is not None
        job.locked_until = None
        await verify_session.commit()
        with caplog.at_level(logging.WARNING, logger=runner_module.__name__):
            assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "ready"
    assert rec.error is None
    assert rec.original_key is None
    assert (rec.playback_key, rec.peaks_key) == (old_playback, old_peaks)
    assert (rec.playback_rev, rec.playback_start_ms, rec.playback_end_ms, rec.duration_ms) == (
        old_state
    )
    # Every attempt copied a backup before its upload failed; none may outlive it.
    assert original_key(rec.user_id, rec.id, "audio/mp4") in store.written
    assert set(store.keys()) == keys_before
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None
    gave_up = [record for record in caplog.records if record.getMessage() == "trim gave up"]
    assert len(gave_up) == 1
    assert gave_up[0].levelno == logging.ERROR
    assert gave_up[0].exc_info is not None
    assert isinstance(gave_up[0].exc_info[1], RuntimeError)


async def test_trim_cleans_up_its_uploads_when_it_fails_late(
    trim_runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A failure after both uploads must leave no object nothing will ever reference."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old_playback = rec.playback_key
    await save_trim(verify_session, rec, 500, 1500)
    real_lock_user = trim_module.lock_user

    async def lock_then_fail(session, user_id) -> None:
        await real_lock_user(session, user_id)
        msg = "boom after the lock"
        raise RuntimeError(msg)

    monkeypatch.setattr(trim_module, "lock_user", lock_then_fail)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.playback_key == old_playback
    new_objects = [key for key in store.written if "/playback-" in key or "/peaks-" in key]
    assert len(new_objects) == 2
    assert not set(new_objects) & set(store.keys())
    job = (await trim_jobs(verify_session, rec))[0]
    assert job.attempts == 1


async def test_trim_cancelled_after_its_backup_deletes_it(
    trim_runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A released trim may never run again, so the backup it copied cannot wait for a retry."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, 1500)
    backup = original_key(rec.user_id, rec.id, "audio/mp4")
    reached_lock = asyncio.Event()

    async def hang_at_the_lock(_session, _user_id) -> None:
        reached_lock.set()
        await asyncio.sleep(60)

    monkeypatch.setattr(trim_module, "lock_user", hang_at_the_lock)
    task = asyncio.create_task(job_runner.run_once())
    await asyncio.wait_for(reached_lock.wait(), timeout=10)
    assert await store.head(backup) is not None
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert await store.head(backup) is None
    job = (await trim_jobs(verify_session, rec))[0]
    assert job.attempts == 0


async def test_trim_skips_deleted_recording(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, 1500)
    rec.deleted_at = utc_now()
    await verify_session.commit()
    store.written.clear()
    await job_runner.run_once()
    assert store.written == []
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None
    await job_runner.run_once()
    assert await store.list_keys(recording_prefix(rec.user_id, rec.id)) == []


async def test_trim_skips_a_recording_that_already_matches(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await enqueue_job(verify_session, rec, JobKind.TRIM)
    await verify_session.commit()
    store.written.clear()
    assert await job_runner.run_once() == 1
    assert store.written == []
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_requeues_when_changed_during_job(
    trim_runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A trim saved while the cut runs wins: the stale cut is dropped and a new job queued."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old = (rec.playback_key, rec.peaks_key, rec.playback_start_ms, rec.playback_end_ms)
    await save_trim(verify_session, rec, 200, 1800)
    real_cut = trim_module.cut

    async def push_trim_then_cut(source, target, start_ms, end_ms) -> None:
        async with make_sessionmaker(engine)() as pusher:
            pushed = await pusher.get(Recording, rec.id)
            pushed.trim_start_ms = 500
            pushed.trim_end_ms = 1500
            # The running job already holds the one trim slot, so the push queues nothing.
            assert await enqueue_job(pusher, pushed, JobKind.TRIM) is None
            await pusher.commit()
        await real_cut(source, target, start_ms, end_ms)

    monkeypatch.setattr(trim_module, "cut", push_trim_then_cut)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.trim_start_ms, rec.trim_end_ms) == (500, 1500)
    assert (rec.playback_key, rec.peaks_key, rec.playback_start_ms, rec.playback_end_ms) == old
    stale_cut = [key for key in store.written if "/playback-" in key or "/peaks-" in key]
    assert len(stale_cut) == 2
    assert not set(stale_cut) & set(store.keys())
    assert {old[0], old[1]} <= set(store.keys())
    jobs = await trim_jobs(verify_session, rec)
    assert len(jobs) == 1
    assert jobs[0].attempts == 0

    monkeypatch.setattr(trim_module, "cut", real_cut)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_start_ms, rec.playback_end_ms) == (500, 1500)
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_commits_nothing_when_deleted_during_job(
    trim_runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A recording deleted while its cut runs keeps its files, and the purge takes them all."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old = (rec.playback_key, rec.peaks_key, rec.playback_rev, rec.playback_start_ms)
    await save_trim(verify_session, rec, 500, 1500)
    real_upload = store.upload

    async def delete_after_the_cut_uploads(path, key: str, content_type: str) -> int:
        size = await real_upload(path, key, content_type)
        if "/peaks-" in key:
            async with make_sessionmaker(engine)() as deleter:
                row = await deleter.get(Recording, rec.id)
                row.deleted_at = utc_now()
                await deleter.commit()
        return size

    monkeypatch.setattr(store, "upload", delete_after_the_cut_uploads)
    job_runner._purge = AsyncMock(return_value=0)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_key, rec.peaks_key, rec.playback_rev, rec.playback_start_ms) == old
    cut = [key for key in store.written if "/playback-" in key or "/peaks-" in key]
    assert len(cut) == 2
    assert not set(cut) & set(store.keys())
    assert await trim_jobs(verify_session, rec) == []

    del job_runner._purge
    await job_runner.run_once()
    assert await store.list_keys(recording_prefix(rec.user_id, rec.id)) == []


async def test_a_superseded_trim_failure_leaves_the_new_claim_alone(
    trim_runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A trim that outran its lock must not write its failure over the job's new claim."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, 1500)
    reclaimed_until = utc_now() + timedelta(hours=1)

    async def reclaim_then_fail(source, target, start_ms, end_ms) -> None:
        async with make_sessionmaker(engine)() as other:
            job = await other.scalar(select(Job).where(Job.recording_id == rec.id))
            job.locked_until = reclaimed_until
            job.attempts += 1
            await other.commit()
        msg = "boom on a stale claim"
        raise RuntimeError(msg)

    monkeypatch.setattr(trim_module, "cut", reclaim_then_fail)
    assert await job_runner.run_once() == 1
    [job] = await trim_jobs(verify_session, rec)
    assert job.locked_until == reclaimed_until
    assert job.attempts == 2
    assert job.last_error is None


def _reclaim_then_fail(
    engine, recording_id: uuid.UUID, reclaimed_until: datetime
) -> Callable[..., Awaitable[bytes]]:
    """A stand-in for a job's slow step: another pass claims the job, then the step fails."""

    async def step(*_args) -> bytes:
        async with make_sessionmaker(engine)() as other:
            job = await other.scalar(select(Job).where(Job.recording_id == recording_id))
            job.locked_until = reclaimed_until
            job.attempts += 1
            await other.commit()
        msg = "boom on a stale claim"
        raise RuntimeError(msg)

    return step


async def test_a_superseded_transcode_failure_leaves_the_new_claim_alone(
    runner, verify_session, engine, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    reclaimed_until = utc_now() + timedelta(hours=1)
    monkeypatch.setattr(
        transcode_module, "build_peaks", _reclaim_then_fail(engine, rec.id, reclaimed_until)
    )
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    # The new claim moved it to processing; the stale failure must not move it back.
    assert rec.state == "processing"
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    assert (job.locked_until, job.attempts, job.last_error) == (reclaimed_until, 2, None)


async def test_a_superseded_peaks_failure_leaves_the_new_claim_alone(
    runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    reclaimed_until = utc_now() + timedelta(hours=1)
    monkeypatch.setattr(
        peaks_job_module, "build_peaks", _reclaim_then_fail(engine, rec.id, reclaimed_until)
    )
    assert await job_runner.run_once() == 1
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    assert (job.locked_until, job.attempts, job.last_error) == (reclaimed_until, 2, None)


def _finish_elsewhere_then_fail(engine, recording_id: uuid.UUID) -> Callable[..., Awaitable[bytes]]:
    """A stand-in for a job's slow step: another pass claims and finishes the job, then it fails."""

    async def step(*_args) -> bytes:
        async with make_sessionmaker(engine)() as other:
            job = await other.scalar(select(Job).where(Job.recording_id == recording_id))
            await other.delete(job)
            await other.commit()
        msg = "boom after another pass finished the job"
        raise RuntimeError(msg)

    return step


async def test_a_transcode_failure_after_another_pass_finished_the_job_is_quiet(
    runner, verify_session, engine, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    monkeypatch.setattr(
        transcode_module, "build_peaks", _finish_elsewhere_then_fail(engine, rec.id)
    )
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "processing"
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def test_a_peaks_failure_after_another_pass_finished_the_job_is_quiet(
    runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed_ready_for_peaks(verify_session, store, media_fixtures, tmp_path)
    monkeypatch.setattr(
        peaks_job_module, "build_peaks", _finish_elsewhere_then_fail(engine, rec.id)
    )
    assert await job_runner.run_once() == 1
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec.id)) is None


async def test_a_trim_failure_after_another_pass_finished_the_job_is_quiet(
    trim_runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, 1500)
    finish = _finish_elsewhere_then_fail(engine, rec.id)

    async def cut(source, target, start_ms, end_ms) -> None:
        await finish()

    monkeypatch.setattr(trim_module, "cut", cut)
    assert await job_runner.run_once() == 1
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_writes_back_a_range_it_had_to_clamp(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    """A trim shorter than the minimum is cut at the minimum and stored that way, so no job loops."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 700, 1200)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.trim_start_ms, rec.trim_end_ms) == (700, 1700)
    assert (rec.playback_start_ms, rec.playback_end_ms) == (700, 1700)
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_without_a_cut_writes_nothing(verify_session, media_fixtures, tmp_path) -> None:
    """A row with no original is only backed up when a cut is about to drop audio."""
    store = _WriteTrackingStore()
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    assert rec.original_key is None
    keys_before = set(store.keys())
    work = tmp_path / "no-cut"
    work.mkdir()
    assert await trim(verify_session, store, rec, work) == []
    assert store.written == []
    assert set(store.keys()) == keys_before
    assert rec.original_key is None


async def test_trim_clamped_to_the_playback_range_writes_nothing(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    """An end past the source clamps to the playback range already there: no cut, no backup."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old_playback = rec.playback_key
    await save_trim(verify_session, rec, 0, rec.source_duration_ms + 5000)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert store.written == []
    assert rec.playback_key == old_playback
    assert rec.original_key is None
    assert rec.trim_end_ms == rec.source_duration_ms
    assert await trim_jobs(verify_session, rec) == []


async def test_trim_requeues_when_peaks_change_during_job(
    trim_runner, verify_session, engine, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A cut sliced from a peaks file the row no longer names is stale."""
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    await save_trim(verify_session, rec, 500, 1500)
    newer_peaks = peaks_key(rec.user_id, rec.id, new_rev())
    real_cut = trim_module.cut

    async def swap_peaks_then_cut(source, target, start_ms, end_ms) -> None:
        async with make_sessionmaker(engine)() as writer:
            row = await writer.get(Recording, rec.id)
            row.peaks_key = newer_peaks
            await writer.commit()
        await real_cut(source, target, start_ms, end_ms)

    monkeypatch.setattr(trim_module, "cut", swap_peaks_then_cut)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.peaks_key == newer_peaks
    assert (rec.playback_start_ms, rec.playback_end_ms) == (0, rec.source_duration_ms)
    stale_cut = [key for key in store.written if "/playback-" in key or "/peaks-" in key]
    assert len(stale_cut) == 2
    assert not set(stale_cut) & set(store.keys())
    assert len(await trim_jobs(verify_session, rec)) == 1


async def test_trim_commit_failure_counts_an_attempt_and_leaves_no_orphans(
    trim_runner, verify_session, media_fixtures, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    old_playback, old_peaks = rec.playback_key, rec.peaks_key
    keys_before = set(store.keys())
    await save_trim(verify_session, rec, 500, 1500)

    async def fail_to_queue(session, recording) -> None:
        msg = "boom after the cut"
        raise RuntimeError(msg)

    monkeypatch.setattr(runner_module, "ensure_trim_job", fail_to_queue)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert (rec.playback_key, rec.peaks_key) == (old_playback, old_peaks)
    assert rec.original_key is None
    assert len(store.written) == 3
    assert set(store.keys()) == keys_before
    job = (await trim_jobs(verify_session, rec))[0]
    assert job.attempts == 1
    assert job.last_error == "boom after the cut"


async def test_transcode_commit_failure_counts_an_attempt_and_leaves_no_orphans(
    runner, verify_session, media_fixtures, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = runner
    rec = await seed(verify_session, store, media_fixtures["m4a"], "audio/mp4")
    keys_before = set(store.keys())

    async def fail_to_queue(session, recording) -> None:
        msg = "boom after the transcode"
        raise RuntimeError(msg)

    monkeypatch.setattr(runner_module, "ensure_trim_job", fail_to_queue)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.state == "uploaded"
    assert rec.playback_key is None
    assert set(store.keys()) == keys_before
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec.id))
    assert job.attempts == 1


async def test_ensure_trim_job_skips_a_deleted_recording(
    verify_session, media_fixtures, tmp_path
) -> None:
    store = FakeObjectStore()
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    rec.trim_start_ms = 500
    rec.deleted_at = utc_now()
    await ensure_trim_job(verify_session, rec)
    await verify_session.commit()
    assert await trim_jobs(verify_session, rec) == []


async def add_loop(session, rec: Recording, start_ms: int, end_ms: int) -> RecordingLoop:
    """A live loop written straight to the table, past the push-time clamp."""
    row = RecordingLoop(
        id=uuid.uuid4(),
        user_id=rec.user_id,
        recording_id=rec.id,
        label=None,
        start_ms=start_ms,
        end_ms=end_ms,
        color=0,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(row)
    await session.flush()
    return row


async def test_transcode_reclamps_loops_to_the_measured_length(
    session, media_fixtures, tmp_path
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    long, outside = (
        await add_loop(session, rec, 500, 30_000),
        await add_loop(session, rec, 30_000, 40_000),
    )
    await transcode(session, store, rec, tmp_path)
    await session.refresh(long)
    await session.refresh(outside)
    assert (long.start_ms, long.end_ms) == (500, rec.source_duration_ms)
    assert long.deleted_at is None
    assert outside.deleted_at is not None


async def test_peaks_job_reclamps_loops_to_the_measured_length(
    session, media_fixtures, tmp_path
) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    await session.refresh(rec)
    rec.duration_ms = None
    rec.source_duration_ms = None
    rec.playback_end_ms = None
    rec.trim_end_ms = None
    await session.flush()
    long = await add_loop(session, rec, 500, 60_000)
    backfill_dir = tmp_path / "backfill"
    backfill_dir.mkdir()
    await build_recording_peaks(session, store, rec, backfill_dir)
    await session.refresh(long)
    assert (long.start_ms, long.end_ms) == (500, rec.source_duration_ms)


async def test_trim_reclamps_loops_to_the_trim_it_wrote(
    trim_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = trim_runner
    rec = await seed_ready(verify_session, store, media_fixtures["m4a"], "audio/mp4", tmp_path)
    past_end = rec.source_duration_ms + 5000
    long = await add_loop(verify_session, rec, 500, past_end - 1000)
    await save_trim(verify_session, rec, 0, past_end)
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    await verify_session.refresh(long)
    assert rec.trim_end_ms == rec.source_duration_ms
    assert (long.start_ms, long.end_ms) == (500, rec.source_duration_ms)
