"""One transcode from the uploaded object to the playback file, with the original kept cold."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.media import cut, encode, needs_encode, probe, remux
from crosstune.jobs.peaks import build_peaks
from crosstune.recordings.service import bump_server_seq
from crosstune.recordings.trim import clamp_trim
from crosstune.storage.store import (
    PEAKS_MIME,
    PLAYBACK_MIME,
    new_rev,
    original_key,
    peaks_key,
    playback_key,
    upload_key,
)

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore


@dataclass(frozen=True)
class _Trim:
    """The clamped trim a transcode applies, already narrowed to the source's real length."""

    start_ms: int
    end_ms: int
    needs_cut: bool


async def _write_playback(
    store: ObjectStore,
    recording: Recording,
    source: Path,
    target: Path,
    work_dir: Path,
    *,
    must_encode: bool,
    trim: _Trim,
) -> None:
    """Produce the playback file at `target` and back up the source, by whichever path it needs.

    The backup always ends up holding the whole source, never just the trimmed range:
    an encode path copies the raw upload as is, and a passthrough path that needs a cut
    remuxes the upload to a full file first and keeps that instead of the raw upload.
    """
    source_key = upload_key(recording.user_id, recording.id)
    if must_encode:
        uploaded = await store.head(source_key)
        content_type = uploaded.content_type if uploaded else "application/octet-stream"
        kept = original_key(recording.user_id, recording.id, content_type)
        await store.copy(source_key, kept)
        recording.original_key = kept
        recording.original_bytes = await asyncio.to_thread(lambda: source.stat().st_size)
        if trim.needs_cut:
            await cut(source, target, trim.start_ms, trim.end_ms)
        else:
            await encode(source, target)
    elif trim.needs_cut:
        full = work_dir / "full.m4a"
        await remux(source, full)
        kept = original_key(recording.user_id, recording.id, PLAYBACK_MIME)
        recording.original_bytes = await store.upload(full, kept, PLAYBACK_MIME)
        recording.original_key = kept
        await cut(full, target, trim.start_ms, trim.end_ms)
    else:
        await remux(source, target)
        # A prior attempt's backup, if any, still holds the whole source and is
        # never deleted, so a retry that no longer needs a cut keeps pointing at
        # it instead of orphaning it with a null write.
        if recording.original_key is None:
            recording.original_bytes = None


async def _write_peaks(
    store: ObjectStore, recording: Recording, target: Path, work_dir: Path
) -> None:
    """Build the waveform peaks for `target` and set the recording's peaks columns."""
    peaks_path = work_dir / "peaks.bin"
    peaks_path.write_bytes(await build_peaks(target))
    rev = new_rev()
    key = peaks_key(recording.user_id, recording.id, rev)
    recording.peaks_bytes = await store.upload(peaks_path, key, PEAKS_MIME)
    recording.peaks_key = key
    recording.peaks_rev = rev


async def _reclamp_trim(session: AsyncSession, recording: Recording) -> None:
    """Re-read the trim columns under the user's lock and narrow them if they need it.

    A client can push a newer trim while the download and ffmpeg work above run
    with no lock held, so the values read at the top of `transcode` may already be
    stale by the time the row is about to commit. Reading them again now, after
    the lock, and writing back only when clamping actually changes them keeps a
    concurrent push from ever being clobbered by the stale values this run started
    with; a trim left narrower than the playback just produced is caught by the
    caller's `ensure_trim_job`.
    """
    await session.refresh(recording, attribute_names=["trim_start_ms", "trim_end_ms"])
    start_ms, end_ms = clamp_trim(
        recording.trim_start_ms, recording.trim_end_ms, low=0, high=recording.source_duration_ms
    )
    if (start_ms, end_ms) != (recording.trim_start_ms, recording.trim_end_ms):
        recording.trim_start_ms = start_ms
        recording.trim_end_ms = end_ms


async def transcode(
    session: AsyncSession, store: ObjectStore, recording: Recording, work_dir: Path
) -> None:
    """Produce the playback file for one uploaded recording and mark it ready.

    Applies whatever trim was saved before upload, clamped now that the source's
    real length is known, and builds the waveform peaks for the resulting playback
    file. The uploaded object is left in the bucket: it is what a retry reads, and
    the caller deletes it once the row is committed.

    A failure partway through can leave server-owned columns set on the in-memory
    row without a matching commit; the caller must refresh the row from the
    database before persisting a failure state.

    Args:
        session: The session the recording is attached to. The caller commits.
        store: Where the uploaded object lives and the results go.
        recording: A recording in the uploaded or processing state.
        work_dir: A directory for temp files, cleaned by the caller.
    """
    source = work_dir / "upload"
    target = work_dir / "playback.m4a"
    await store.download(upload_key(recording.user_id, recording.id), source)
    info = await probe(source)
    recording.source_duration_ms = info.duration_ms

    # Only ever used to decide what to actually cut; the row's own trim columns
    # are re-read and reconciled under the lock below, once the row is about to
    # commit, so a trim pushed while this runs is never overwritten with this.
    start_ms, end_ms = clamp_trim(
        recording.trim_start_ms, recording.trim_end_ms, low=0, high=info.duration_ms
    )
    effective_end_ms = end_ms if end_ms is not None else info.duration_ms
    trim = _Trim(
        start_ms=start_ms,
        end_ms=effective_end_ms,
        needs_cut=start_ms != 0 or effective_end_ms != info.duration_ms,
    )

    await _write_playback(
        store, recording, source, target, work_dir, must_encode=needs_encode(info), trim=trim
    )

    result = await probe(target)
    rev = new_rev()
    key = playback_key(recording.user_id, recording.id, rev)
    recording.playback_bytes = await store.upload(target, key, PLAYBACK_MIME)
    recording.playback_key = key
    recording.playback_rev = rev
    recording.playback_mime = PLAYBACK_MIME
    recording.duration_ms = result.duration_ms
    recording.playback_start_ms = trim.start_ms
    recording.playback_end_ms = trim.end_ms

    await _write_peaks(store, recording, target, work_dir)

    recording.state = "ready"
    recording.error = None
    # The lock is what keeps this seq in commit order with the user's pushes; the
    # caller's commit releases it.
    await lock_user(session, recording.user_id)
    await _reclamp_trim(session, recording)
    bump_server_seq(recording)
    await session.flush()
