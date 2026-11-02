"""Mono detection: whether a recording's two channels carry the same audio."""

from __future__ import annotations

import shutil
import subprocess
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select

from crosstune.db.engine import make_sessionmaker
from crosstune.jobs.mono import _EnergyReducer, measure_mono
from crosstune.jobs.runner import JobRunner
from crosstune.jobs.transcode import transcode
from crosstune.models import Job, Recording
from crosstune.storage.store import upload_key
from crosstune.vocabulary import JobKind
from tests.fakes import FakeObjectStore
from tests.test_jobs import add_recording, make_uploaded, make_user

if TYPE_CHECKING:
    from pathlib import Path

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

SINE = "sine=frequency=440:duration=2"


def _render(path: Path, *args: str) -> Path:
    """Write a WAV built from lavfi sources, with a fixed argument list."""
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg is not installed")
    subprocess.run(  # noqa: S603 -- fixed argv, no shell
        ["ffmpeg", "-v", "error", "-y", *args, "-c:a", "pcm_s16le", "-f", "wav", str(path)],  # noqa: S607 -- resolved from PATH, no shell
        check=True,
    )
    return path


def _stereo(path: Path, left: str, right: str) -> Path:
    """Join two lavfi sources into the left and right channels of one file."""
    return _render(
        path,
        "-f",
        "lavfi",
        "-i",
        left,
        "-f",
        "lavfi",
        "-i",
        right,
        "-filter_complex",
        "[0:a][1:a]join=inputs=2:channel_layout=stereo[out]",
        "-map",
        "[out]",
    )


async def test_one_channel_is_mono(tmp_path: Path) -> None:
    source = _render(tmp_path / "one.wav", "-f", "lavfi", "-i", SINE, "-ac", "1")
    assert await measure_mono(source) is True


async def test_identical_channels_are_mono(tmp_path: Path) -> None:
    source = _render(tmp_path / "same.wav", "-f", "lavfi", "-i", SINE, "-ac", "2")
    assert await measure_mono(source) is True


async def test_one_silent_channel_is_mono(tmp_path: Path) -> None:
    source = _stereo(tmp_path / "left.wav", SINE, "anullsrc=channel_layout=mono:duration=2")
    assert await measure_mono(source) is True


async def test_panned_sources_are_stereo(tmp_path: Path) -> None:
    source = _stereo(tmp_path / "panned.wav", SINE, "sine=frequency=660:duration=2")
    assert await measure_mono(source) is False


async def test_slight_level_offset_is_mono(tmp_path: Path) -> None:
    source = _render(
        tmp_path / "offset.wav",
        "-f",
        "lavfi",
        "-i",
        SINE,
        "-af",
        "pan=stereo|c0=c0|c1=0.891251*c0",
    )
    assert await measure_mono(source) is True


async def test_large_level_offset_is_mono(tmp_path: Path) -> None:
    source = _render(
        tmp_path / "quieter.wav",
        "-f",
        "lavfi",
        "-i",
        SINE,
        "-af",
        "pan=stereo|c0=c0|c1=0.501187*c0",
    )
    assert await measure_mono(source) is True


async def test_silent_stereo_is_mono(tmp_path: Path) -> None:
    source = _render(
        tmp_path / "silent.wav", "-f", "lavfi", "-i", "anullsrc=duration=2", "-ac", "2"
    )
    assert await measure_mono(source) is True


def test_an_empty_stream_is_mono() -> None:
    reducer = _EnergyReducer()
    reducer.feed(b"")
    assert reducer.is_mono() is True


@pytest.fixture
def runner(engine, tmp_path: Path, settings: Settings) -> tuple[JobRunner, FakeObjectStore]:
    store = FakeObjectStore()
    return JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings), store


async def _ready_with_mono_job(
    verify_session, store: FakeObjectStore, media_fixtures, work_dir: Path, *, is_mono: bool | None
) -> Recording:
    """A transcoded recording holding `is_mono`, with the mono job its transcode queued."""
    user = await make_user(verify_session)
    rec = await make_uploaded(verify_session, store, user, media_fixtures["m4a"], "audio/mp4")
    await transcode(verify_session, store, rec, work_dir)
    await store.delete(upload_key(user.id, rec.id))
    rec.is_mono = is_mono
    await verify_session.commit()
    await verify_session.refresh(rec)
    return rec


async def _mono_jobs(verify_session, rec: Recording) -> list[Job]:
    return list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == JobKind.MONO.value)
        )
    )


async def test_mono_job_measures_an_unmeasured_recording(
    runner, verify_session, media_fixtures, tmp_path: Path
) -> None:
    job_runner, store = runner
    rec = await _ready_with_mono_job(verify_session, store, media_fixtures, tmp_path, is_mono=None)
    before_seq = rec.server_seq
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.is_mono is True
    assert rec.server_seq > before_seq
    assert await _mono_jobs(verify_session, rec) == []


async def test_mono_job_keeps_a_stored_flag(
    runner, verify_session, media_fixtures, tmp_path: Path
) -> None:
    job_runner, store = runner
    rec = await _ready_with_mono_job(verify_session, store, media_fixtures, tmp_path, is_mono=False)
    before_seq = rec.server_seq
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.is_mono is False
    assert rec.server_seq == before_seq
    assert await _mono_jobs(verify_session, rec) == []


async def test_mono_job_drops_a_recording_with_no_playback_file(runner, verify_session) -> None:
    job_runner, _ = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "pending_upload")
    verify_session.add(Job(recording_id=rec.id, user_id=user.id, kind=JobKind.MONO.value))
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.is_mono is None
    assert await _mono_jobs(verify_session, rec) == []


async def test_mono_job_retries_when_the_playback_file_is_missing(runner, verify_session) -> None:
    job_runner, _ = runner
    user = await make_user(verify_session)
    rec = await add_recording(verify_session, user, "ready", playback_key="u/r/missing")
    verify_session.add(Job(recording_id=rec.id, user_id=user.id, kind=JobKind.MONO.value))
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await verify_session.refresh(rec)
    assert rec.is_mono is None
    [job] = await _mono_jobs(verify_session, rec)
    await verify_session.refresh(job)
    assert job.last_error is not None
    assert job.locked_until is not None
