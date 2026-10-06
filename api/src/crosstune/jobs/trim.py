"""Re-cuts a recording's playback file from its untouched original after a trim is saved."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from functools import partial
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.locks import lock_user
from crosstune.jobs.peaks import build_peaks, slice_peaks
from crosstune.jobs.recut import recut_playback
from crosstune.recordings.loops import reclamp_recording_loops
from crosstune.recordings.service import attach_peaks, attach_playback
from crosstune.recordings.trim import clamp_trim, effective_end
from crosstune.storage.store import (
    PEAKS_MIME,
    PLAYBACK_MIME,
    delete_best_effort,
    original_key,
    peaks_key,
    upload_revision,
)

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore, Revision

log = logging.getLogger(__name__)


class TrimError(Exception):
    """The recording's files are not in a shape a trim can safely cut from."""


@dataclass(frozen=True)
class _Cut:
    """The playback and peaks files one trim attempt uploaded, not yet on the row."""

    playback: Revision
    duration_ms: int
    peaks: Revision


@dataclass(frozen=True)
class _Files:
    """The row's current playback file and the source range it covers."""

    playback_key: str
    start_ms: int
    end_ms: int
    source_duration_ms: int


def _current_files(recording: Recording) -> _Files:
    """Read the playback file and the source range it covers from a ready row.

    Raises:
        TrimError: The row has no playback file or no complete range to cut against.
    """
    source_duration_ms = recording.source_duration_ms
    start_ms = recording.playback_start_ms
    end_ms = recording.playback_end_ms
    if (
        recording.playback_key is None
        or source_duration_ms is None
        or start_ms is None
        or end_ms is None
    ):
        msg = (
            f"recording {recording.id} has no complete playback file to trim: "
            f"key={recording.playback_key}, range={start_ms}-{end_ms}, "
            f"source={source_duration_ms}"
        )
        raise TrimError(msg)
    return _Files(recording.playback_key, start_ms, end_ms, source_duration_ms)


async def _back_up_playback(store: ObjectStore, recording: Recording, files: _Files) -> str:
    """Keep the playback file as the original when it is the only full copy of the source.

    A playback file that no longer covers the whole source would lose audio for
    good if it were kept as the original, so that shape is refused instead.

    Returns:
        str: The original's key, already set on the row.
    """
    if (files.start_ms, files.end_ms) != (0, files.source_duration_ms):
        msg = (
            f"recording {recording.id} has no original and its playback file covers "
            f"{files.start_ms}-{files.end_ms} of a {files.source_duration_ms} ms source"
        )
        raise TrimError(msg)
    kept = original_key(recording.user_id, recording.id, PLAYBACK_MIME)
    await store.copy(files.playback_key, kept)
    stored = await store.head(kept)
    if stored is None:
        msg = f"the original backup {kept} did not land in the bucket"
        raise TrimError(msg)
    recording.original_key = kept
    recording.original_bytes = stored.size
    return kept


async def _require_backup(store: ObjectStore, key: str) -> None:
    """Refuse to commit a backup that is no longer in the bucket.

    A failed attempt that finds no original on its row deletes this same key while
    holding the user's lock, and so must be checked for under that lock: a row
    must never name an original that is gone.

    Raises:
        TrimError: The backup object is missing.
    """
    if await store.head(key) is None:
        msg = f"the original backup {key} was removed before it could be kept"
        raise TrimError(msg)


async def _cut_and_upload(
    store: ObjectStore,
    recording: Recording,
    *,
    original: str,
    files: _Files,
    kept: tuple[int, int],
    work_dir: Path,
    uploaded: list[str],
) -> _Cut:
    """Cut the original to the kept range and upload new playback and peaks revisions.

    Every key is appended to `uploaded` before its upload starts, so the caller
    can delete what this attempt left behind if anything after it fails.
    """
    start_ms, end_ms = kept
    source = work_dir / "original"
    target = work_dir / "playback.m4a"
    await store.download(original, source)
    playback, info = await recut_playback(
        store, recording, source=source, kept=kept, target=target, uploaded=uploaded
    )

    peaks_path = work_dir / "peaks.bin"
    if recording.peaks_key is not None:
        current = work_dir / "current-peaks.bin"
        await store.download(recording.peaks_key, current)
        # The current peaks file starts where the current playback file does.
        peaks_path.write_bytes(
            slice_peaks(current.read_bytes(), start_ms - files.start_ms, end_ms - files.start_ms)
        )
    else:
        peaks_path.write_bytes(await build_peaks(target))

    peaks = await upload_revision(
        store,
        peaks_path,
        PEAKS_MIME,
        partial(peaks_key, recording.user_id, recording.id),
        uploaded=uploaded,
    )
    return _Cut(playback=playback, duration_ms=info.duration_ms, peaks=peaks)


def _apply(recording: Recording, result: _Cut, start_ms: int, end_ms: int) -> list[str]:
    """Point the row at the new files and return the keys they supersede."""
    superseded = [key for key in (recording.playback_key, recording.peaks_key) if key is not None]
    attach_playback(
        recording, result.playback, duration_ms=result.duration_ms, start_ms=start_ms, end_ms=end_ms
    )
    attach_peaks(recording, result.peaks)
    return superseded


def _write_clamped_trim(recording: Recording, start_ms: int, end_ms: int) -> None:
    """Store the trim the cut actually applied, so the row stops asking for another job.

    A null end that already meant the source end stays null.
    """
    stored_end: int | None = end_ms
    if recording.trim_end_ms is None and end_ms == recording.source_duration_ms:
        stored_end = None
    if (recording.trim_start_ms, recording.trim_end_ms) != (start_ms, stored_end):
        recording.trim_start_ms = start_ms
        recording.trim_end_ms = stored_end


async def trim(
    session: AsyncSession, store: ObjectStore, recording: Recording, work_dir: Path
) -> list[str]:
    """Re-cut the playback file and peaks of a ready recording to its saved trim.

    Always cuts from the original, never from the current playback file, so every
    playback file stays one encode from the source. The original is never modified
    or deleted: when the row has none yet, the playback file still covers the whole
    source and is copied to become it.

    A client can save a newer trim while the cut runs with no lock held. If the
    trim, the playback file, or the row's deletion changed by the time the lock is
    taken, the cut is stale: its uploads are deleted and the row keeps its current
    files, so the caller's `ensure_trim_job` queues the newest trim instead.

    Args:
        session: The session the recording is attached to. The caller commits.
        store: Where the recording's files live and the new ones go.
        recording: A ready recording whose trim differs from its playback range.
        work_dir: A directory for temp files, cleaned by the caller.

    Returns:
        list[str]: The superseded playback and peaks keys, to delete only after
        the caller's commit.
    """
    requested = (recording.trim_start_ms, recording.trim_end_ms)
    peaks_key_used = recording.peaks_key
    files = _current_files(recording)
    start_ms, end_ms = clamp_trim(
        recording.trim_start_ms,
        effective_end(recording),
        low=files.start_ms,
        high=files.end_ms,
    )
    if end_ms is None:
        msg = f"recording {recording.id} has no source length to trim against"
        raise TrimError(msg)
    needs_cut = (start_ms, end_ms) != (files.start_ms, files.end_ms)

    backup_key: str | None = None
    uploaded: list[str] = []
    try:
        result: _Cut | None = None
        if needs_cut:
            # Only a cut drops audio from the playback file, so only a cut needs the
            # playback file kept first when it is the only full copy.
            original = recording.original_key
            if original is None:
                backup_key = await _back_up_playback(store, recording, files)
                original = backup_key
            result = await _cut_and_upload(
                store,
                recording,
                original=original,
                files=files,
                kept=(start_ms, end_ms),
                work_dir=work_dir,
                uploaded=uploaded,
            )
        # The lock is what keeps this seq in commit order with the user's pushes; the
        # caller's commit releases it.
        await lock_user(session, recording.user_id)
        await session.refresh(
            recording,
            attribute_names=[
                "trim_start_ms",
                "trim_end_ms",
                "deleted_at",
                "playback_key",
                "peaks_key",
            ],
        )
        if backup_key is not None:
            await _require_backup(store, backup_key)
        stale = (
            (recording.trim_start_ms, recording.trim_end_ms) != requested
            or recording.playback_key != files.playback_key
            or recording.peaks_key != peaks_key_used
            or recording.deleted_at is not None
        )
        superseded: list[str] = []
        if stale:
            await delete_best_effort(
                store, uploaded, log=log, message="could not delete a stale trim cut"
            )
        else:
            _write_clamped_trim(recording, start_ms, end_ms)
            await reclamp_recording_loops(session, recording, utc_now())
            if result is not None:
                superseded = _apply(recording, result, start_ms, end_ms)
        bump_server_seq(recording)
        await session.flush()
    except BaseException:
        # The caller rolls the row back, but these objects are already in the
        # bucket and nothing will ever reference them. A cancelled job cleans up too.
        await delete_best_effort(
            store, uploaded, log=log, message="could not delete an orphaned trim cut"
        )
        raise
    return superseded
