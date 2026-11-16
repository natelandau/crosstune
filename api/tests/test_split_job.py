"""The split job: each piece cut from its parent's original, then the parent's original narrowed."""

from __future__ import annotations

import asyncio
import dataclasses
import itertools
import re
import uuid
from typing import TYPE_CHECKING
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select

from crosstune.db.base import utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.files.quota import OVER_QUOTA, used_bytes
from crosstune.jobs import split as split_module
from crosstune.jobs import transcode as transcode_module
from crosstune.jobs.attempt import MAX_ATTEMPTS, PROCESSING_FAILED, JobContext, client_message
from crosstune.jobs.handlers import split as split_handler
from crosstune.jobs.handlers import transcode as transcode_handler
from crosstune.jobs.media import MAX_SLICE_OVERRUN_MS, MediaError
from crosstune.jobs.peaks import decode_peaks
from crosstune.jobs.runner import JobRunner
from crosstune.jobs.transcode import RECORDING_TOO_LONG
from crosstune.models import Job, Recording, Tune, User
from crosstune.recordings.service import ensure_split_job, ensure_trim_job
from crosstune.recordings.split_rules import split_holds_original, split_ready_to_complete
from crosstune.storage.store import original_key, recording_prefix, upload_key
from crosstune.sync.push import cascade_delete
from crosstune.sync.tables import TABLES
from crosstune.vocabulary import SPLIT_FAILED, JobKind
from tests.fakes import FakeObjectStore
from tests.helpers import GAPPED_STALL_MS, make_tone
from tests.test_jobs import (
    add_recording,
    grant_premium,
    make_uploaded,
    make_user,
    probe_key,
    seed_ready,
)
from tests.test_media import decoded_ms

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable, Iterable
    from pathlib import Path

    from crosstune.config import Settings
    from crosstune.jobs.media import Probe, Slice
    from crosstune.storage.store import Revision

pytestmark = pytest.mark.anyio

# How far a piece's playback length may land from its range: AAC frames are about 23 ms.
TOLERANCE_MS = 50
REVISIONED_ORIGINAL = re.compile(r"/original-[0-9a-f]{8}\.m4a$")


class _OrderedStore(FakeObjectStore):
    """Records every write and delete in order, and can check each delete as it happens."""

    def __init__(self) -> None:
        super().__init__()
        self.writes: list[str] = []
        self.deletes: list[str] = []
        self.before_delete: Callable[[tuple[str, ...]], Awaitable[None]] | None = None

    async def upload(self, path, key: str, content_type: str) -> int:
        self.writes.append(key)
        return await super().upload(path, key, content_type)

    async def copy(self, source: str, target: str) -> None:
        self.writes.append(target)
        await super().copy(source, target)

    async def delete(self, *keys: str) -> None:
        if self.before_delete is not None:
            await self.before_delete(keys)
        self.deletes.extend(keys)
        await super().delete(*keys)


def _runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, _OrderedStore]:
    store = _OrderedStore()
    return JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings), store


@pytest.fixture
def split_runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, _OrderedStore]:
    return _runner(engine, tmp_path, settings)


@pytest.fixture(scope="module")
def tones(tmp_path_factory: pytest.TempPathFactory) -> dict[int, Path]:
    """AAC tones by length in seconds, built once for the module."""
    folder = tmp_path_factory.mktemp("split-tones")
    paths = {}
    for seconds in (10, 60):
        path = folder / f"tone-{seconds}.m4a"
        make_tone(path, seconds)
        paths[seconds] = path
    return paths


async def _seed_ready(verify_session, store, path: Path, content_type: str, tmp_path) -> Recording:
    parent = await seed_ready(verify_session, store, path, content_type, tmp_path)
    # A split's pieces count against the quota, which only Premium has.
    await grant_premium(verify_session, parent.user_id)
    await verify_session.commit()
    await verify_session.refresh(parent)
    return parent


async def _seed(verify_session, store: _OrderedStore, path: Path, tmp_path) -> Recording:
    parent = await _seed_ready(verify_session, store, path, "audio/mp4", tmp_path)
    store.writes.clear()
    store.deletes.clear()
    return parent


async def _add_piece(verify_session, parent: Recording, n: int, bounds: list[int]) -> Recording:
    user = await verify_session.get(User, parent.user_id)
    return await add_recording(
        verify_session,
        user,
        "processing",
        split_from_id=parent.id,
        created_by_split_id=parent.split_id,
        trim_start_ms=bounds[n - 1],
        trim_end_ms=bounds[n],
    )


async def _split(
    verify_session, parent: Recording, cuts: list[int], *, arrive: Iterable[int] | None = None
) -> tuple[list[int], list[Recording]]:
    """What a split's push leaves behind: the parent narrowed to piece 1, and some pieces.

    Returns:
        The piece bounds on the source timeline, and the pieces that arrived, in order.
    """
    bounds = [parent.trim_start_ms, *cuts, parent.source_duration_ms]
    parent.split_id = uuid.uuid4()
    parent.split_size = len(cuts) + 1
    parent.trim_end_ms = cuts[0]
    numbers = range(2, len(bounds)) if arrive is None else arrive
    pieces = [await _add_piece(verify_session, parent, n, bounds) for n in numbers]
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()
    return bounds, pieces


async def _jobs(verify_session, rec: Recording, kind: JobKind) -> list[Job]:
    return list(
        await verify_session.scalars(
            select(Job).where(Job.recording_id == rec.id, Job.kind == kind.value)
        )
    )


async def _refresh(verify_session, *rows: Recording) -> None:
    for row in rows:
        await verify_session.refresh(row)


async def test_split_cuts_each_piece_from_the_original(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[60], tmp_path)
    bounds, pieces = await _split(verify_session, parent, [20_000, 40_000])
    seqs = [piece.server_seq for piece in pieces]

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    for n, (piece, seq) in enumerate(zip(pieces, seqs, strict=True), start=2):
        start, end = bounds[n - 1], bounds[n]
        assert piece.state == "ready"
        assert piece.error is None
        assert piece.server_seq > seq
        assert (piece.trim_start_ms, piece.trim_end_ms) == (start, end)
        assert (piece.playback_start_ms, piece.playback_end_ms) == (start, end)
        assert abs(await probe_key(store, piece.playback_key, tmp_path) - (end - start)) <= (
            TOLERANCE_MS
        )
        assert abs(piece.duration_ms - (end - start)) <= TOLERANCE_MS
        assert piece.source_offset_ms <= piece.trim_start_ms
        assert REVISIONED_ORIGINAL.search(piece.original_key)
        assert piece.original_key.startswith(recording_prefix(piece.user_id, piece.id))
        slice_ms = await probe_key(store, piece.original_key, tmp_path)
        assert piece.source_duration_ms == piece.source_offset_ms + slice_ms
        assert piece.source_duration_ms >= end
        assert piece.original_bytes == len(store.get_bytes(piece.original_key))
        assert abs(len(decode_peaks(store.get_bytes(piece.peaks_key))) - (end - start) // 20) <= 1
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_split_replaces_parent_original_only_when_complete(
    split_runner, verify_session, engine, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    bounds, (second,) = await _split(verify_session, parent, [3_000, 6_000], arrive=[2])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, second)
    assert second.state == "ready"
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert parent.original_key == full
    assert (parent.source_offset_ms, parent.source_duration_ms) == (0, bounds[-1])
    assert full in set(store.keys())
    # No piece waits for its cut, so the parent's trim no longer waits either.
    assert len(await _jobs(verify_session, parent, JobKind.TRIM)) == 1

    named_at_delete: list[str | None] = []

    async def record_parent_original(keys: tuple[str, ...]) -> None:
        if full in keys:
            async with make_sessionmaker(engine)() as session:
                row = await session.get(Recording, parent.id)
                named_at_delete.append(row.original_key)

    store.before_delete = record_parent_original
    third = await _add_piece(verify_session, parent, 3, bounds)
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, third)
    assert third.state == "ready"
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert parent.source_offset_ms == 0
    slice_ms = await probe_key(store, parent.original_key, tmp_path)
    assert parent.source_duration_ms == slice_ms
    assert parent.source_duration_ms >= 3_000
    assert parent.original_bytes == len(store.get_bytes(parent.original_key))
    # The full original went only after the commit that stopped naming it.
    assert full not in set(store.keys())
    assert len(named_at_delete) == 1
    assert named_at_delete[0] == parent.original_key


async def test_split_pieces_arrive_before_parent_trim(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    split_id = uuid.uuid4()
    bounds = [0, 3_000, 6_000, parent.source_duration_ms]
    user = await verify_session.get(User, parent.user_id)
    pieces = [
        await add_recording(
            verify_session,
            user,
            "processing",
            split_from_id=parent.id,
            created_by_split_id=split_id,
            trim_start_ms=bounds[n - 1],
            trim_end_ms=bounds[n],
        )
        for n in (2, 3)
    ]
    # The parent has not yet carried the split to the server, so nothing is queued.
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []

    parent.split_id, parent.split_size, parent.trim_end_ms = split_id, 3, 3_000
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    for n, piece in enumerate(pieces, start=2):
        assert piece.state == "ready"
        assert piece.source_offset_ms <= bounds[n - 1]
        assert piece.source_duration_ms >= bounds[n]
        assert abs(piece.duration_ms - (bounds[n] - bounds[n - 1])) <= TOLERANCE_MS
    # Every piece was cut before the parent's original was narrowed to its own range.
    parent_slice = store.writes.index(parent.original_key)
    assert all(store.writes.index(piece.original_key) < parent_slice for piece in pieces)
    assert parent.source_duration_ms >= 3_000


async def test_split_of_parent_without_original_backs_it_up_first(
    split_runner, verify_session, media_fixtures, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, media_fixtures["m4a"], tmp_path)
    assert parent.original_key is None
    full_audio = store.get_bytes(parent.playback_key)
    _, (piece,) = await _split(verify_session, parent, [1_000])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    backup = original_key(parent.user_id, parent.id, "audio/mp4")
    assert store.writes[0] == backup
    assert store.uploaded.count(backup) == 0
    assert piece.state == "ready"
    assert piece.source_offset_ms <= 1_000
    # The backup held the whole source until the parent's original was narrowed.
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert backup in store.deletes
    assert backup not in set(store.keys())
    assert len(store.get_bytes(parent.original_key)) < len(full_audio)


async def test_split_runs_for_soft_deleted_parent(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, pieces = await _split(verify_session, parent, [3_000, 6_000])
    parent.deleted_at = utc_now()
    await verify_session.commit()

    assert await job_runner.run_once() >= 1
    for piece in pieces:
        await verify_session.refresh(piece)
        assert piece.state == "ready"
        assert piece.original_key in set(store.keys())
    # A deleted parent's original is left whole for the purge sweep, never narrowed.
    prefix = recording_prefix(parent.user_id, parent.id)
    assert not any(
        REVISIONED_ORIGINAL.search(key) for key in store.writes if key.startswith(prefix)
    )


async def test_piece_deleted_mid_cut_is_skipped_and_uploads_deleted(
    split_runner, verify_session, engine, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    real_rewrite = split_module.rewrite_playback

    async def rewrite_then_delete(*args, **kwargs) -> tuple[Revision, Probe]:
        result = await real_rewrite(*args, **kwargs)
        async with make_sessionmaker(engine)() as session:
            row = await session.get(Recording, piece.id)
            row.deleted_at = utc_now()
            await session.commit()
        return result

    monkeypatch.setattr(split_module, "rewrite_playback", rewrite_then_delete)

    # The purge sweep in the same pass removes the deleted piece's row afterward.
    assert await job_runner.run_once() >= 1
    await verify_session.refresh(parent)
    prefix = recording_prefix(piece.user_id, piece.id)
    written = [key for key in store.writes if key.startswith(prefix)]
    assert len(written) == 3
    # The job deleted every file it cut, key by key, rather than leaving them to the purge.
    assert set(written) <= set(store.deletes)
    assert not [key for key in set(store.keys()) if key.startswith(prefix)]
    # A deleted piece counts toward completion, so the parent's original was narrowed.
    assert REVISIONED_ORIGINAL.search(parent.original_key)


async def test_piece_whose_slice_decodes_past_its_range_fails_alone(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[60], tmp_path)
    _, (long_piece, piece) = await _split(verify_session, parent, [20_000, 40_000])
    real_copy_slice = split_module.copy_slice

    async def copy_slice_running_long(source, target, start_ms, end_ms, **kwargs) -> Slice:
        sliced = await real_copy_slice(source, target, start_ms, end_ms, **kwargs)
        if start_ms != long_piece.trim_start_ms:
            return sliced
        overrun = end_ms - start_ms + MAX_SLICE_OVERRUN_MS + 1
        return sliced._replace(info=dataclasses.replace(sliced.info, duration_ms=overrun))

    monkeypatch.setattr(split_module, "copy_slice", copy_slice_running_long)
    assert await job_runner.run_once() == 1
    await _refresh(verify_session, long_piece, piece)
    assert (long_piece.state, long_piece.error) == ("failed", client_message(MediaError()))
    prefix = recording_prefix(long_piece.user_id, long_piece.id)
    assert not [key for key in store.writes if key.startswith(prefix)]
    assert piece.state == "ready"
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def _failing_split(
    verify_session, store, tones, tmp_path, monkeypatch, attempts: int
) -> tuple[Recording, Recording]:
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, pieces = await _split(verify_session, parent, [3_000, 6_000], arrive=[2])
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    job.attempts = attempts
    await verify_session.commit()

    async def broken_slice(*_args, **_kwargs) -> int:
        msg = "could not slice"
        raise MediaError(msg)

    monkeypatch.setattr(split_module, "copy_slice", broken_slice)
    return parent, pieces[0]


async def test_split_gives_up_after_max_attempts_and_fails_waiting_pieces(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent, piece = await _failing_split(
        verify_session, store, tones, tmp_path, monkeypatch, MAX_ATTEMPTS - 1
    )
    seq = piece.server_seq

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert (piece.state, piece.error) == ("failed", SPLIT_FAILED)
    assert piece.server_seq > seq
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert parent.original_key == full
    assert full in set(store.keys())
    assert (parent.state, parent.error) == ("ready", None)
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


@pytest.mark.parametrize("attempts", [MAX_ATTEMPTS - 1, MAX_ATTEMPTS], ids=["failed", "abandoned"])
async def test_a_completion_that_fails_every_attempt_closes_the_split(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch, attempts
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    job.attempts = attempts
    piece.state, piece.original_key = "ready", f"{recording_prefix(piece.user_id, piece.id)}x"
    await verify_session.commit()

    async def broken_completion(*_args, **_kwargs) -> None:
        msg = "could not complete"
        raise MediaError(msg)

    monkeypatch.setattr(split_handler, "complete_split", broken_completion)
    playback = parent.playback_key
    assert await job_runner.run_once() >= 1
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    assert parent.playback_key == playback
    assert playback in set(store.keys())
    # No later pass queues the split again.
    await job_runner.run_once()
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_split_retries_before_its_last_attempt(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent, piece = await _failing_split(verify_session, store, tones, tmp_path, monkeypatch, 0)

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert piece.state == "processing"
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    assert job.last_error == "could not slice"
    # The backup the first attempt committed stays the parent's original.
    assert parent.original_key == original_key(parent.user_id, parent.id, "audio/mp4")


async def test_split_abandoned_fails_waiting_pieces(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent, piece = await _failing_split(
        verify_session, store, tones, tmp_path, monkeypatch, MAX_ATTEMPTS
    )
    playback = parent.playback_key

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert (piece.state, piece.error) == ("failed", SPLIT_FAILED)
    # The parent keeps its only full copy: its playback file, never cut or backed up.
    assert parent.original_key is None
    assert parent.playback_key == playback
    assert playback in set(store.keys())
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_a_piece_revived_after_its_split_completed_fails_instead_of_being_cut(
    engine, settings: Settings, verify_session, tones, tmp_path
) -> None:
    store = _OrderedStore()
    ctx = JobContext(make_sessionmaker(engine), store, settings, work_root=tmp_path)
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    piece.deleted_at = utc_now()
    await verify_session.commit()
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    await split_handler.run(ctx, job)
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id

    # A newer push brings the piece back before the purge resets it.
    piece.deleted_at = None
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()
    await verify_session.refresh(piece)
    assert (piece.state, piece.error, piece.original_key) == ("failed", SPLIT_FAILED, None)
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_parent_trim_runs_after_split_completes(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [4_000])
    assert await _jobs(verify_session, parent, JobKind.TRIM) == []

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert len(await _jobs(verify_session, parent, JobKind.TRIM)) == 1

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert (parent.playback_start_ms, parent.playback_end_ms) == (0, 4_000)
    assert abs(await probe_key(store, parent.playback_key, tmp_path) - 4_000) <= TOLERANCE_MS
    assert abs(len(decode_peaks(store.get_bytes(parent.peaks_key))) - 200) <= 1
    assert await _jobs(verify_session, parent, JobKind.TRIM) == []


async def test_one_split_job_cuts_a_piece_pushed_while_it_ran(
    split_runner, verify_session, engine, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    bounds, (second,) = await _split(verify_session, parent, [3_000, 6_000], arrive=[2])
    real_rewrite = split_module.rewrite_playback
    pushed: list[uuid.UUID] = []

    async def rewrite_then_push(*args, **kwargs) -> tuple[Revision, Probe]:
        result = await real_rewrite(*args, **kwargs)
        if not pushed:
            async with make_sessionmaker(engine)() as session:
                row = await session.get(Recording, parent.id)
                third = await _add_piece(session, row, 3, bounds)
                pushed.append(third.id)
                await ensure_split_job(session, row)
                await session.commit()
        return result

    monkeypatch.setattr(split_module, "rewrite_playback", rewrite_then_push)

    assert await job_runner.run_once() == 1
    third = await verify_session.get(Recording, pushed[0])
    await _refresh(verify_session, parent, second, third)
    assert (second.state, third.state) == ("ready", "ready")
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def _run_all(job_runner: JobRunner, verify_session) -> None:
    """Run jobs until none is left queued."""
    while await verify_session.scalar(select(Job.id).limit(1)) is not None:
        await job_runner.run_once()


async def test_trim_of_a_piece_runs(split_runner, verify_session, tones, tmp_path) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    await _run_all(job_runner, verify_session)
    await verify_session.refresh(piece)
    assert piece.state == "ready"
    assert piece.source_offset_ms > 0
    assert piece.playback_start_ms == 5_000
    cut_peaks = decode_peaks(store.get_bytes(piece.peaks_key))

    piece.trim_start_ms, piece.trim_end_ms = 6_000, 9_000
    await ensure_trim_job(verify_session, piece)
    await verify_session.commit()
    assert len(await _jobs(verify_session, piece, JobKind.TRIM)) == 1

    await _run_all(job_runner, verify_session)
    await verify_session.refresh(piece)
    assert (piece.playback_start_ms, piece.playback_end_ms) == (6_000, 9_000)
    assert abs(await probe_key(store, piece.playback_key, tmp_path) - 3_000) <= TOLERANCE_MS
    # The trim slices the piece's own peaks, which start where its playback file did.
    assert decode_peaks(store.get_bytes(piece.peaks_key)) == cut_peaks[50:200]


async def test_completed_split_stays_complete_when_a_piece_is_split_again(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    seq = parent.server_seq
    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, piece)
    assert parent.split_completed_id == parent.split_id
    assert parent.server_seq > seq
    assert (piece.split_id, piece.split_size) == (None, None)

    _, (grandchild,) = await _split(verify_session, piece, [7_500])
    assert not await split_holds_original(verify_session, parent)
    assert await split_holds_original(verify_session, piece)

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, piece, grandchild)
    assert grandchild.state == "ready"
    assert grandchild.split_from_id == piece.id
    assert grandchild.source_offset_ms <= 7_500
    assert piece.split_completed_id == piece.split_id
    assert REVISIONED_ORIGINAL.search(piece.original_key)
    assert not await split_holds_original(verify_session, parent)
    assert not await split_holds_original(verify_session, piece)
    assert not await split_ready_to_complete(verify_session, piece)
    assert (piece.playback_start_ms, piece.playback_end_ms) == (5_000, 7_500)


def _revisioned_originals(store: _OrderedStore, rec: Recording) -> list[str]:
    prefix = recording_prefix(rec.user_id, rec.id)
    return [k for k in store.writes if k.startswith(prefix) and REVISIONED_ORIGINAL.search(k)]


async def test_failure_after_a_piece_slice_upload_deletes_the_slice(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    full_audio = store.get_bytes(parent.playback_key)
    _, (piece,) = await _split(verify_session, parent, [5_000])

    async def broken_rewrite(*_args, **_kwargs) -> tuple[Revision, Probe]:
        msg = "encode failed"
        raise RuntimeError(msg)

    monkeypatch.setattr(split_module, "rewrite_playback", broken_rewrite)

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    (piece_slice,) = _revisioned_originals(store, piece)
    assert piece_slice not in set(store.keys())
    assert (piece.state, piece.original_key) == ("processing", None)
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert parent.original_key == full
    assert store.get_bytes(full) == full_audio


async def test_completion_cleanup_never_deletes_an_original_written_after_its_commit(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [4_000])
    orphan = original_key(parent.user_id, parent.id, "audio/mp4", rev="0badc0de")
    store.put_bytes(orphan, b"x", "audio/mp4")
    # What a later split job of the same parent writes once this job's row is gone.
    later = original_key(parent.user_id, parent.id, "audio/mp4", rev="1a7e5a1e")
    delete_superseded = split_handler.delete_best_effort

    async def later_job_writes_then_delete(store_arg, keys, **kwargs) -> None:
        store.put_bytes(later, b"y", "audio/mp4")
        await delete_superseded(store_arg, keys, **kwargs)

    monkeypatch.setattr(split_handler, "delete_best_effort", later_job_writes_then_delete)

    await _run_all(job_runner, verify_session)
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    keys = set(store.keys())
    assert later in keys
    assert orphan not in keys
    assert parent.original_key in keys


async def test_failure_before_the_completion_commit_deletes_the_parent_slice(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    full_audio = store.get_bytes(parent.playback_key)
    _, (piece,) = await _split(verify_session, parent, [5_000])

    async def broken_trim_job(*_args, **_kwargs) -> None:
        msg = "queue failed"
        raise RuntimeError(msg)

    monkeypatch.setattr(split_handler, "ensure_trim_job", broken_trim_job)

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert piece.state == "ready"
    (parent_slice,) = _revisioned_originals(store, parent)
    assert parent_slice not in set(store.keys())
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert (parent.original_key, parent.split_completed_id) == (full, None)
    assert store.get_bytes(full) == full_audio


async def test_cancelled_completion_deletes_the_parent_slice(
    engine, settings: Settings, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = _OrderedStore()
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [5_000])
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)

    async def cancelled_trim_job(*_args, **_kwargs) -> None:
        raise asyncio.CancelledError

    monkeypatch.setattr(split_handler, "ensure_trim_job", cancelled_trim_job)
    ctx = JobContext(make_sessionmaker(engine), store, settings, work_root=tmp_path)

    with pytest.raises(asyncio.CancelledError):
        await split_handler.run(ctx, job)
    await verify_session.refresh(parent)
    (parent_slice,) = _revisioned_originals(store, parent)
    assert parent_slice not in set(store.keys())
    assert parent.original_key == original_key(parent.user_id, parent.id, "audio/mp4")
    assert parent.original_key in set(store.keys())


async def test_failed_piece_holds_the_split_open_until_deleted(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent, second = await _failing_split(
        verify_session, store, tones, tmp_path, monkeypatch, MAX_ATTEMPTS - 1
    )
    assert await job_runner.run_once() == 1
    await verify_session.refresh(second)
    assert second.state == "failed"
    monkeypatch.undo()

    bounds = [0, 3_000, 6_000, parent.source_duration_ms]
    await verify_session.refresh(parent)
    third = await _add_piece(verify_session, parent, 3, bounds)
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, third)
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert third.state == "ready"
    assert (parent.original_key, parent.split_completed_id) == (full, None)
    assert full in set(store.keys())
    # The failed piece keeps the split open, but holds neither the original nor Delete.
    assert not await split_ready_to_complete(verify_session, parent)
    assert not await split_holds_original(verify_session, parent)
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []

    # What a push that deletes the failed piece does.
    second.deleted_at = utc_now()
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()
    await _run_all(job_runner, verify_session)
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert full not in set(store.keys())


async def test_a_cascade_deleted_failed_piece_lets_the_sweep_complete_the_split(
    split_runner, verify_session, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    job.attempts = MAX_ATTEMPTS - 1
    tune = Tune(
        id=uuid.uuid4(),
        owner_user_id=parent.user_id,
        title="Angeline",
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    verify_session.add(tune)
    await verify_session.flush()
    piece.tune_id = tune.id
    await verify_session.commit()

    async def broken_slice(*_args, **_kwargs) -> int:
        msg = "could not slice"
        raise MediaError(msg)

    monkeypatch.setattr(split_module, "copy_slice", broken_slice)
    assert await job_runner.run_once() == 1
    monkeypatch.undo()
    await verify_session.refresh(piece)
    assert piece.state == "failed"

    tune.deleted_at = utc_now()
    await cascade_delete(verify_session, TABLES["tunes"], [tune.id], utc_now(), parent.user_id)
    await verify_session.commit()
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []

    # The sweep queues the split job, which the same pass then runs.
    assert await job_runner.run_once() >= 2
    await _refresh(verify_session, parent, piece)
    assert piece.deleted_at is not None
    assert parent.split_completed_id == parent.split_id
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_parent_trimmed_during_completion_completes_on_a_later_run(
    split_runner, verify_session, engine, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [5_000])
    real_copy_slice = split_module.copy_slice
    trimmed: list[bool] = []

    async def copy_then_trim(source, target, *args, **kwargs) -> int:
        result = await real_copy_slice(source, target, *args, **kwargs)
        if target.name == "parent-slice" and not trimmed:
            async with make_sessionmaker(engine)() as session:
                row = await session.get(Recording, parent.id)
                row.trim_start_ms = 1_000
                await session.commit()
            trimmed.append(True)
        return result

    monkeypatch.setattr(split_module, "copy_slice", copy_then_trim)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    full = original_key(parent.user_id, parent.id, "audio/mp4")
    assert (parent.original_key, parent.split_completed_id) == (full, None)
    assert _revisioned_originals(store, parent)[0] not in set(store.keys())
    (job,) = await _jobs(verify_session, parent, JobKind.SPLIT)
    assert (job.attempts, job.last_error) == (0, None)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert 1_000 - TOLERANCE_MS <= parent.source_offset_ms <= 1_000
    assert parent.source_duration_ms >= 5_000
    assert full not in set(store.keys())


async def test_piece_trim_widened_mid_cut_is_cut_again(
    split_runner, verify_session, engine, tones, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    piece.trim_end_ms = 8_000
    await verify_session.commit()
    real_rewrite = split_module.rewrite_playback
    cuts: list[tuple[int, int]] = []

    async def rewrite_then_widen(*args, **kwargs) -> tuple[Revision, Probe]:
        result = await real_rewrite(*args, **kwargs)
        cuts.append(kwargs["kept"])
        if len(cuts) == 1:
            async with make_sessionmaker(engine)() as session:
                row = await session.get(Recording, piece.id)
                row.trim_end_ms = 9_500
                await session.commit()
        return result

    monkeypatch.setattr(split_module, "rewrite_playback", rewrite_then_widen)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(piece)
    assert cuts == [(5_000, 8_000), (5_000, 9_500)]
    assert piece.state == "ready"
    assert (piece.trim_start_ms, piece.trim_end_ms) == (5_000, 9_500)
    assert (piece.playback_start_ms, piece.playback_end_ms) == (5_000, 9_500)
    assert piece.source_duration_ms >= 9_500
    # The first cut's files were deleted rather than left beside the second's.
    prefix = recording_prefix(piece.user_id, piece.id)
    assert len([key for key in set(store.keys()) if key.startswith(prefix)]) == 3


async def _seed_uploaded_parent(
    verify_session, store: _OrderedStore, path: Path, *, split_size: int | None, **fields
) -> Recording:
    """An uploaded parent with its transcode queued, as a client's push leaves it."""
    user = await make_user(verify_session)
    await grant_premium(verify_session, user.id)
    parent = await make_uploaded(verify_session, store, user, path, "audio/mp4")
    parent.split_id = uuid.uuid4() if split_size else None
    parent.split_size = split_size
    for name, value in fields.items():
        setattr(parent, name, value)
    verify_session.add(Job(recording_id=parent.id, user_id=user.id))
    await verify_session.commit()
    return parent


async def test_four_hour_split_parent_is_accepted(
    split_runner, verify_session, four_hour_m4a, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed_uploaded_parent(
        verify_session,
        store,
        four_hour_m4a,
        split_size=2,
        trim_start_ms=0,
        trim_end_ms=60_000,
    )
    piece = await _add_piece(verify_session, parent, 1, [14_340_000, 14_400_000])
    await verify_session.commit()

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, piece)

    assert (parent.state, piece.state) == ("ready", "ready")
    # The parent's original keeps everything up to where its piece starts.
    assert 14_340_000 <= parent.source_duration_ms < 14_340_000 + TOLERANCE_MS
    assert abs(await probe_key(store, parent.playback_key, tmp_path) - 60_000) <= TOLERANCE_MS
    assert abs(await probe_key(store, piece.playback_key, tmp_path) - 60_000) <= TOLERANCE_MS
    assert (piece.playback_start_ms, piece.playback_end_ms) == (14_340_000, 14_400_000)
    assert parent.split_completed_id == parent.split_id
    assert piece.source_duration_ms >= 14_400_000 - TOLERANCE_MS
    assert upload_key(parent.user_id, parent.id) not in set(store.keys())


async def test_four_hour_unsplit_recording_is_refused(
    split_runner, verify_session, four_hour_m4a
) -> None:
    job_runner, store = split_runner
    parent = await _seed_uploaded_parent(verify_session, store, four_hour_m4a, split_size=None)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert (parent.state, parent.error) == ("failed", RECORDING_TOO_LONG)


async def test_split_parent_over_twelve_hours_is_refused(
    split_runner, verify_session, tones, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    real_probe = transcode_module.probe

    async def thirteen_hours(path: Path) -> Probe:
        return dataclasses.replace(await real_probe(path), duration_ms=13 * 3_600_000)

    monkeypatch.setattr(transcode_module, "probe", thirteen_hours)
    parent = await _seed_uploaded_parent(
        verify_session, store, tones[10], split_size=2, trim_start_ms=0, trim_end_ms=60_000
    )

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert (parent.state, parent.error) == ("failed", RECORDING_TOO_LONG)


async def test_parent_transcode_failure_fails_waiting_pieces(
    split_runner, verify_session, tones, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed_uploaded_parent(
        verify_session, store, tones[10], split_size=2, trim_start_ms=0, trim_end_ms=3_000
    )
    piece = await _add_piece(verify_session, parent, 1, [3_000, 6_000])
    await verify_session.commit()
    monkeypatch.setattr(transcode_module, "MAX_RECORDING_MS", 1000)
    monkeypatch.setattr(transcode_module, "MAX_SPLIT_SOURCE_MS", 1000)

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert (parent.state, parent.error) == ("failed", RECORDING_TOO_LONG)
    assert (piece.state, piece.error) == ("failed", RECORDING_TOO_LONG)
    # A failed parent has nothing to cut from, so its split completes with its pieces failed.
    assert parent.split_completed_id == parent.split_id


async def test_split_parent_with_open_end_inside_three_hours_is_accepted(
    split_runner, verify_session, four_hour_m4a, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed_uploaded_parent(
        verify_session,
        store,
        four_hour_m4a,
        split_size=2,
        trim_start_ms=14_400_000 - 60_000,
        trim_end_ms=None,
    )
    await _add_piece(verify_session, parent, 1, [0, 60_000])

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert (parent.state, parent.error) == ("ready", None)
    assert abs(await probe_key(store, parent.playback_key, tmp_path) - 60_000) <= 2 * TOLERANCE_MS


async def test_split_parent_with_open_end_over_three_hours_is_refused(
    split_runner, verify_session, four_hour_m4a
) -> None:
    job_runner, store = split_runner
    parent = await _seed_uploaded_parent(
        verify_session, store, four_hour_m4a, split_size=2, trim_start_ms=0, trim_end_ms=None
    )

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert (parent.state, parent.error) == ("failed", RECORDING_TOO_LONG)


async def test_source_over_three_hours_is_never_remuxed_or_encoded_whole(
    split_runner, verify_session, four_hour_m4a, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    remux = AsyncMock()
    encode = AsyncMock()
    monkeypatch.setattr(transcode_module, "remux", remux)
    monkeypatch.setattr(transcode_module, "encode", encode)
    parent = await _seed_uploaded_parent(
        verify_session, store, four_hour_m4a, split_size=2, trim_start_ms=0, trim_end_ms=60_000
    )
    await _add_piece(verify_session, parent, 1, [14_340_000, 14_400_000])

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert parent.state == "ready"
    remux.assert_not_awaited()
    encode.assert_not_awaited()


async def test_abandoned_parent_transcode_fails_waiting_pieces(
    split_runner, verify_session, tones, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    monkeypatch.setattr(transcode_handler, "transcode", AsyncMock())
    parent = await _seed_uploaded_parent(
        verify_session, store, tones[10], split_size=2, trim_start_ms=0, trim_end_ms=3_000
    )
    piece = await _add_piece(verify_session, parent, 1, [3_000, 6_000])
    (job,) = await _jobs(verify_session, parent, JobKind.TRANSCODE)
    job.attempts = MAX_ATTEMPTS
    await verify_session.commit()

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, piece)
    assert (parent.state, parent.error) == ("failed", PROCESSING_FAILED)
    assert (piece.state, piece.error) == ("failed", PROCESSING_FAILED)
    assert parent.split_completed_id == parent.split_id


async def test_split_of_a_reencoded_original_cuts_each_piece_once(
    split_runner, verify_session, plain_webm, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    # Opus in WebM has no stream-copy container, so each slice is re-encoded.
    parent = await _seed_ready(verify_session, store, plain_webm, "audio/webm", tmp_path)
    store.writes.clear()
    _, pieces = await _split(verify_session, parent, [1_825, 3_781])
    real_rewrite = split_module.rewrite_playback
    cuts: list[tuple[int, int]] = []

    async def counted_rewrite(*args, **kwargs) -> tuple[Revision, Probe]:
        cuts.append(kwargs["kept"])
        if len(cuts) > len(pieces):
            msg = f"a piece was cut again: {cuts}"
            raise RuntimeError(msg)
        return await real_rewrite(*args, **kwargs)

    monkeypatch.setattr(split_module, "rewrite_playback", counted_rewrite)

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    assert len(cuts) == len(pieces)
    assert [piece.state for piece in pieces] == ["ready", "ready"]
    assert parent.split_completed_id == parent.split_id


async def test_split_of_a_webm_with_a_timestamp_gap_leaves_no_gap_between_pieces(
    split_runner, verify_session, gapped_webm, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed_ready(verify_session, store, gapped_webm, "audio/webm", tmp_path)
    store.writes.clear()
    _, pieces = await _split(verify_session, parent, [1_843, 3_781])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    assert parent.split_completed_id == parent.split_id
    assert [r.state for r in (parent, *pieces)] == ["ready"] * 3
    assert parent.trim_end_ms == 1_843
    ranges = [(r.trim_start_ms, r.trim_end_ms) for r in (parent, *pieces)]
    assert ranges[:2] == [(0, 1_843), (1_843, 3_781)]
    assert ranges[2][0] == 3_781


async def test_split_reads_the_parent_original_once_per_attempt(
    split_runner, verify_session, gapped_webm, tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_runner, store = split_runner
    parent = await _seed_ready(verify_session, store, gapped_webm, "audio/webm", tmp_path)
    await _split(verify_session, parent, [1_843, 3_781])
    scanned: list[Path] = []
    real_scan = split_module.scan_stalls

    async def counted_scan(source: Path, info: Probe) -> object:
        scanned.append(source)
        return await real_scan(source, info)

    monkeypatch.setattr(split_module, "scan_stalls", counted_scan)

    assert await job_runner.run_once() == 1
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    # Two pieces and the parent's own slice, all cut from one scan of the original.
    assert len(scanned) == 1


async def test_split_with_a_cut_inside_a_stall_leaves_contiguous_pieces(
    split_runner, verify_session, gapped_webm, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed_ready(verify_session, store, gapped_webm, "audio/webm", tmp_path)
    store.writes.clear()
    _, pieces = await _split(verify_session, parent, [1_050, 3_781])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    assert [r.state for r in (parent, *pieces)] == ["ready"] * 3
    ranges = [(r.trim_start_ms, r.trim_end_ms) for r in (parent, *pieces)]
    assert ranges[:2] == [(0, 1_050), (1_050, 3_781)]
    assert ranges[2][0] == 3_781


async def test_split_at_a_stall_end_leaves_contiguous_pieces_of_their_length(
    split_runner, verify_session, gapped_webm, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed_ready(verify_session, store, gapped_webm, "audio/webm", tmp_path)
    store.writes.clear()
    bounds, pieces = await _split(verify_session, parent, [GAPPED_STALL_MS[1], 3_781])

    # The split, then the parent's trim to the first piece.
    assert await job_runner.run_once() == 1
    assert await job_runner.run_once() == 1
    await _refresh(verify_session, parent, *pieces)
    rows = (parent, *pieces)
    assert [r.state for r in rows] == ["ready"] * 3
    ranges = [(r.trim_start_ms, r.trim_end_ms) for r in rows]
    assert ranges[:2] == list(itertools.pairwise(bounds))[:2]
    assert ranges[2][0] == bounds[2]
    for row, (start, end) in zip(rows[:2], itertools.pairwise(bounds), strict=False):
        path = tmp_path / f"piece-{start}.m4a"
        path.write_bytes(store.get_bytes(row.playback_key))
        assert abs(decoded_ms(path) - (end - start)) <= 1


async def test_a_piece_ready_without_its_slice_never_requeues_the_split(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (piece,) = await _split(verify_session, parent, [5_000])
    piece.state = "ready"
    await verify_session.commit()
    assert len(await _jobs(verify_session, parent, JobKind.SPLIT)) == 1

    await job_runner.run_once()
    await verify_session.refresh(parent)
    assert parent.split_completed_id is None
    assert await _jobs(verify_session, parent, JobKind.SPLIT) == []


async def test_completion_keeps_audio_trimmed_off_the_parent_after_the_split(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [4_000])
    parent.trim_end_ms = 2_000
    await verify_session.commit()

    await _run_all(job_runner, verify_session)
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    assert REVISIONED_ORIGINAL.search(parent.original_key)
    assert parent.source_offset_ms == 0
    # The audio between the parent's new end and the piece's start stays in its original.
    assert parent.source_duration_ms >= 4_000
    assert await probe_key(store, parent.original_key, tmp_path) >= 4_000
    assert (parent.trim_start_ms, parent.trim_end_ms) == (0, 2_000)


async def test_a_piece_of_an_earlier_split_is_still_cut(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, (earlier,) = await _split(verify_session, parent, [3_000, 6_000], arrive=[2])
    # Another device split the parent again before it pulled the first split.
    _, (later,) = await _split(verify_session, parent, [5_000])

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, earlier, later)
    assert (earlier.state, later.state) == ("ready", "ready")
    assert earlier.source_offset_ms <= 3_000
    assert parent.split_completed_id == parent.split_id


async def test_completion_deletes_original_slices_no_row_names(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    await _split(verify_session, parent, [4_000])
    # What an attempt that crashed between its upload and its commit leaves behind.
    orphan = original_key(parent.user_id, parent.id, "audio/mp4", rev="0badc0de")
    store.put_bytes(orphan, b"x", "audio/mp4")

    await _run_all(job_runner, verify_session)
    await verify_session.refresh(parent)
    assert parent.split_completed_id == parent.split_id
    assert orphan not in set(store.keys())
    assert parent.original_key in set(store.keys())


async def test_split_piece_takes_the_parent_mono_flag(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    # Opposite to what the tone measures, so only a copy explains the piece's value.
    parent.is_mono = False
    _, [piece] = await _split(verify_session, parent, [5_000])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, piece)
    assert piece.state == "ready"
    assert piece.is_mono is False
    assert await _jobs(verify_session, piece, JobKind.MONO) == []


async def test_split_piece_of_an_unmeasured_parent_is_measured(
    split_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = split_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    parent.is_mono = None
    _, [piece] = await _split(verify_session, parent, [5_000])

    assert await job_runner.run_once() == 1
    await _refresh(verify_session, piece)
    assert piece.is_mono is None
    assert len(await _jobs(verify_session, piece, JobKind.MONO)) == 1

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, piece)
    assert piece.is_mono is True
    assert await _jobs(verify_session, piece, JobKind.MONO) == []


# A 10 s tone's split, with each piece's original slice and playback file counted, ends
# under this quota, while the parent's full files and its pieces together go over it.
SPLIT_QUOTA = 240_000


@pytest.fixture
def quota_runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, _OrderedStore]:
    return _runner(
        engine, tmp_path, settings.model_copy(update={"premium_quota_bytes": SPLIT_QUOTA})
    )


async def test_a_split_that_divides_the_parent_fits_a_quota_it_briefly_exceeds(
    quota_runner, verify_session, tones, tmp_path
) -> None:
    job_runner, store = quota_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    _, pieces = await _split(verify_session, parent, [3_000, 6_000])

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, *pieces)
    assert [piece.state for piece in pieces] == ["ready", "ready"]
    assert parent.split_completed_id == parent.split_id
    assert await used_bytes(verify_session, parent.user_id) <= SPLIT_QUOTA


@pytest.mark.parametrize("filler_bytes", [0, SPLIT_QUOTA], ids=["some-room", "no-room"])
async def test_a_piece_past_the_quota_fails_and_leaves_no_files(
    quota_runner, verify_session, tones, tmp_path, filler_bytes: int
) -> None:
    job_runner, store = quota_runner
    parent = await _seed(verify_session, store, tones[10], tmp_path)
    user = await verify_session.get(User, parent.user_id)
    if filler_bytes:
        await add_recording(verify_session, user, "ready", playback_bytes=filler_bytes)
    parent.split_id = uuid.uuid4()
    parent.split_size = 4
    # Pieces that each repeat the whole parent rather than divide it.
    pieces = [
        await add_recording(
            verify_session,
            user,
            "processing",
            split_from_id=parent.id,
            created_by_split_id=parent.split_id,
            trim_start_ms=0,
            trim_end_ms=10_000,
        )
        for _ in range(3)
    ]
    await ensure_split_job(verify_session, parent)
    await verify_session.commit()

    await _run_all(job_runner, verify_session)
    await _refresh(verify_session, parent, *pieces)
    failed = [piece for piece in pieces if piece.state == "failed"]
    assert len(failed) == (3 if filler_bytes else 2)
    assert {piece.error for piece in failed} == {OVER_QUOTA}
    for piece in failed:
        prefix = recording_prefix(user.id, piece.id)
        assert not [key for key in set(store.keys()) if key.startswith(prefix)]
        written = [key for key in store.writes if key.startswith(prefix)]
        if filler_bytes:
            # An account with no room left fails the piece without cutting it.
            assert written == []
        else:
            assert written != []
    # The parent's own files are what its pieces are cut from, so only they may exceed it.
    assert await used_bytes(verify_session, user.id, exclude=(parent.id,)) <= SPLIT_QUOTA
