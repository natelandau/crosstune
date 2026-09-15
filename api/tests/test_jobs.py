"""The transcode job and the runner around it."""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from crosstune.db.engine import make_sessionmaker
from crosstune.jobs.runner import MAX_ATTEMPTS, JobRunner
from crosstune.jobs.transcode import transcode
from crosstune.models import Job, Recording, UploadSlot, User
from crosstune.models.user import new_uuid7, utc_now
from crosstune.storage.store import original_key, playback_key, upload_key
from tests.fakes import FakeObjectStore

pytestmark = pytest.mark.anyio


async def make_user(session) -> User:
    user = User(id=new_uuid7(), clerk_user_id=f"user_{uuid.uuid4().hex[:8]}")
    session.add(user)
    await session.flush()
    return user


async def make_uploaded(
    session, store: FakeObjectStore, user: User, path, content_type: str
) -> Recording:
    rec = Recording(
        id=uuid.uuid4(),
        user_id=user.id,
        source="upload",
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        state="uploaded",
        playback_bytes=path.stat().st_size,
    )
    session.add(rec)
    await session.flush()
    store.put_bytes(upload_key(user.id, rec.id), path.read_bytes(), content_type)
    return rec


async def test_transcode_passes_an_aac_upload_through(session, media_fixtures, tmp_path) -> None:
    store = FakeObjectStore()
    user = await make_user(session)
    rec = await make_uploaded(session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(session, store, rec, tmp_path)
    assert rec.state == "ready"
    assert rec.playback_key == playback_key(user.id, rec.id)
    assert rec.playback_mime == "audio/mp4"
    assert rec.playback_bytes == len(store.get_bytes(rec.playback_key))
    assert rec.original_key is None
    assert 1_900 <= rec.duration_ms <= 2_100
    # The upload survives transcode(); the runner deletes it once the row is committed.
    assert sorted(store.keys()) == sorted([rec.playback_key, upload_key(user.id, rec.id)])


@pytest.mark.parametrize(
    ("fixture", "content_type", "extension"),
    [("webm", "audio/webm", "webm"), ("wav", "audio/wav", "wav"), ("mp3", "audio/mpeg", "mp3")],
)
async def test_transcode_encodes_and_keeps_the_original_cold(
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
    assert store.storage_class(rec.original_key) == "STANDARD_IA"
    assert sorted(store.keys()) == sorted(
        [rec.playback_key, rec.original_key, upload_key(user.id, rec.id)]
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
def runner(engine, tmp_path) -> tuple[JobRunner, FakeObjectStore]:
    store = FakeObjectStore()
    return JobRunner(make_sessionmaker(engine), store, poll_seconds=0.01, work_root=tmp_path), store


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


async def test_run_once_leaves_a_recording_ready_when_deleting_the_upload_fails(
    engine, verify_session, media_fixtures, tmp_path
) -> None:
    store = _DeleteFailsStore()
    job_runner = JobRunner(make_sessionmaker(engine), store, poll_seconds=0.01, work_root=tmp_path)
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
        playback_key=playback_key(user.id, rec_id),
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
            expires_at=utc_now(),
        )
    )
    await verify_session.commit()
    store.put_bytes(upload_key(user.id, rec.id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await verify_session.get(UploadSlot, rec.id) is None
    assert await job_runner.run_once() == 0


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
    verify_session.add(
        Recording(
            id=other_id,
            user_id=user.id,
            source="upload",
            recorded_at=utc_now(),
            created_at=utc_now(),
            updated_at=utc_now(),
            state="ready",
            playback_key=playback_key(user.id, other_id),
            playback_bytes=3,
        )
    )
    await verify_session.commit()
    store.put_bytes(playback_key(user.id, other_id), b"abc", "audio/mp4")
    assert await job_runner.run_once() == 1
    assert store.keys() == [playback_key(user.id, other_id)]


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


async def test_run_forever_survives_a_crash_and_sleeps_only_when_idle(runner) -> None:
    job_runner, _ = runner
    mock_run_once = AsyncMock(side_effect=[RuntimeError("boom"), 0, 0])
    reached_three_calls = asyncio.Event()

    async def _run_once() -> int:
        try:
            return await mock_run_once()
        finally:
            if mock_run_once.await_count >= 3:
                reached_three_calls.set()

    job_runner.run_once = _run_once
    task = job_runner.start()
    await asyncio.wait_for(reached_three_calls.wait(), timeout=2)
    await job_runner.stop()
    assert task.done()
    assert mock_run_once.await_count == 3
