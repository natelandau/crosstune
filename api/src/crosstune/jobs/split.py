"""Cuts each piece of a split out of its parent's original, then narrows the parent's original."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from dataclasses import dataclass, field
from functools import partial
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.db.locks import lock_user
from crosstune.jobs.audio_rewrite import rewrite_playback
from crosstune.jobs.media import copy_slice, probe, scan_stalls, slice_content_type
from crosstune.jobs.peaks import range_peaks
from crosstune.jobs.trim import back_up_playback, current_files, require_backup
from crosstune.recordings.loops import reclamp_recording_loops
from crosstune.recordings.service import attach_peaks, attach_playback, ensure_trim_job
from crosstune.recordings.split_rules import split_pieces_start, split_ready_to_complete
from crosstune.recordings.trim_rules import (
    clamp_stored_trim,
    clamp_trim,
    effective_end,
    original_range,
)
from crosstune.storage.store import (
    BEST_EFFORT_DELETE_SECONDS,
    PEAKS_MIME,
    delete_best_effort,
    original_key,
    peaks_key,
    recording_prefix,
    upload_revision,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.media import Probe, Slice, StallMap
    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore, Revision

log = logging.getLogger(__name__)


class SplitError(Exception):
    """The parent's files are not in a shape a split can safely cut from."""


@dataclass(frozen=True)
class _Source:
    """A local copy of one of the parent's originals, with what ffmpeg needs to know of it."""

    path: Path
    info: Probe
    stalls: StallMap


@dataclass
class ParentFiles:
    """The parent's files one split attempt reads, each fetched and read once.

    Args:
        store: Where the parent's files live and the pieces' go.
        work_dir: A directory for temp files, cleaned by the caller.
    """

    store: ObjectStore
    work_dir: Path
    _sources: dict[str, _Source] = field(default_factory=dict)

    async def download(self, key: str) -> Path:
        """Fetch an object into the attempt's folder once, however many pieces read it."""
        path = self.work_dir / f"parent-{key.rpartition('/')[2]}"
        if not path.exists():
            await self.store.download(key, path)
        return path

    async def source(self, key: str) -> _Source:
        """Fetch, probe, and scan an original once, however many pieces are cut from it."""
        if key not in self._sources:
            path = await self.download(key)
            info = await probe(path)
            self._sources[key] = _Source(path, info, await scan_stalls(path, info))
        return self._sources[key]


async def list_unnamed_originals(store: ObjectStore, parent: Recording) -> list[str]:
    """List the parent's original slices its row does not name, logging instead of raising.

    An attempt that crashed between uploading a completion slice and committing it leaves
    that slice behind, and no later attempt names it. Only the split job writes a parent's
    original slices, and its job row keeps any other split job of the parent from running,
    so the caller lists before it writes its own slice and deletes only what it listed.
    A listing taken after its commit could hold a later split job's slice.

    Args:
        store: Where the parent's files live.
        parent: The parent about to complete its split, with its current original key.

    Returns:
        list[str]: The unnamed slice keys, or none when the listing fails.
    """
    prefix = recording_prefix(parent.user_id, parent.id)
    try:
        async with asyncio.timeout(BEST_EFFORT_DELETE_SECONDS):
            listed = await store.list_objects(prefix)
    except Exception:  # noqa: BLE001 -- a leftover object costs storage, never audio
        log.warning("could not list a split parent's originals", extra={"prefix": prefix})
        return []
    return [
        item.key
        for item in listed
        if item.key.removeprefix(prefix).startswith("original-") and item.key != parent.original_key
    ]


def _parent_original(parent: Recording) -> tuple[str, int, int]:
    """Read the parent's original key and the source range it covers.

    Raises:
        SplitError: The parent has no original or no known length.
    """
    low, high = original_range(parent)
    if parent.original_key is None or high is None:
        msg = (
            f"recording {parent.id} has no original to split: "
            f"key={parent.original_key}, range={low}-{high}"
        )
        raise SplitError(msg)
    return parent.original_key, low, high


async def back_up_parent(session: AsyncSession, store: ObjectStore, parent: Recording) -> None:
    """Keep the parent's playback file as its original before any piece is cut from it.

    A parent that was never cut has no original: its playback file is the only full copy
    of the source. The caller commits.

    Args:
        session: The session the parent is attached to.
        store: Where the parent's files live.
        parent: The ready parent with no original.
    """
    kept = await back_up_playback(store, parent, current_files(parent))
    # The trim job's rule: a failed attempt deletes an unnamed backup under this lock.
    await lock_user(session, parent.user_id)
    await require_backup(store, kept)
    await session.flush()


@dataclass(frozen=True)
class _PieceCut:
    """The files one piece's cut uploaded, not yet on its row."""

    original: Revision
    offset_ms: int
    original_end_ms: int
    kept: tuple[int, int]
    playback: Revision
    playback_ms: int
    peaks: Revision


@contextlib.asynccontextmanager
async def _together() -> AsyncGenerator[asyncio.TaskGroup]:
    """Run tasks side by side, cancelling the rest when one fails and raising its error alone.

    Every task has ended by the time this exits, so a caller that deletes what the tasks
    uploaded never races an upload still in flight.
    """
    try:
        async with asyncio.TaskGroup() as group:
            yield group
    except BaseExceptionGroup as errors:
        raise errors.exceptions[0] from None


async def _upload_original_slice(
    store: ObjectStore, recording: Recording, path: Path, content_type: str, uploaded: list[str]
) -> Revision:
    """Upload a slice as the recording's original, under a revision key no reader holds."""
    return await upload_revision(
        store,
        path,
        content_type,
        partial(original_key, recording.user_id, recording.id, content_type),
        uploaded=uploaded,
    )


async def _cut_and_upload(
    files: ParentFiles,
    parent: Recording,
    piece: Recording,
    *,
    kept: tuple[int, int],
    uploaded: list[str],
) -> _PieceCut:
    """Slice the piece's range from the parent's original, then encode and upload its files.

    Every key is appended to `uploaded` before its upload starts, so the caller can
    delete what this cut left behind if anything after it fails.
    """
    store = files.store
    original, low, _ = _parent_original(parent)
    source = await files.source(original)
    folder = files.work_dir / f"piece-{piece.id}"
    folder.mkdir(exist_ok=True)
    slice_path = folder / "original"
    playback_path = folder / "playback.m4a"
    peaks_path = folder / "peaks.bin"

    start_ms, end_ms = kept
    sliced: Slice = await copy_slice(
        source.path,
        slice_path,
        start_ms - low,
        end_ms - low,
        info=source.info,
        stalls=source.stalls,
    )
    offset = low + sliced.start_ms
    original_end = offset + sliced.info.duration_ms
    kept_start, clamped_end = clamp_trim(start_ms, end_ms, low=offset, high=original_end)
    kept_end = original_end if clamped_end is None else clamped_end

    # rewrite_playback reads the offset from the row; the caller re-reads it under the lock.
    piece.source_offset_ms = offset
    async with _together() as group:
        original_task = group.create_task(
            _upload_original_slice(
                store, piece, slice_path, slice_content_type(source.info), uploaded
            )
        )
        playback_task = group.create_task(
            rewrite_playback(
                store,
                piece,
                source=slice_path,
                kept=(kept_start, kept_end),
                target=playback_path,
                uploaded=uploaded,
                source_info=sliced.info,
            )
        )

        async def playback_file() -> Path:
            await playback_task
            return playback_path

        async def upload_peaks() -> Revision:
            parent_peaks = parent.peaks_key
            data = await range_peaks(
                partial(files.download, parent_peaks) if parent_peaks is not None else None,
                # The parent's peaks file starts where its playback file does.
                (parent.playback_start_ms, parent.playback_end_ms),
                (kept_start, kept_end),
                playback_file,
            )
            await asyncio.to_thread(peaks_path.write_bytes, data)
            return await upload_revision(
                store,
                peaks_path,
                PEAKS_MIME,
                partial(peaks_key, piece.user_id, piece.id),
                uploaded=uploaded,
            )

        peaks_task = group.create_task(upload_peaks())
    playback, playback_info = playback_task.result()
    return _PieceCut(
        original=original_task.result(),
        offset_ms=offset,
        original_end_ms=original_end,
        kept=(kept_start, kept_end),
        playback=playback,
        playback_ms=playback_info.duration_ms,
        peaks=peaks_task.result(),
    )


async def _attach_cut(session: AsyncSession, piece: Recording, cut: _PieceCut) -> None:
    """Point the piece at its new files and mark it ready."""
    piece.original_key = cut.original.key
    piece.original_bytes = cut.original.size
    piece.source_offset_ms = cut.offset_ms
    piece.source_duration_ms = cut.original_end_ms
    clamp_stored_trim(piece, high=cut.original_end_ms)
    kept_start, kept_end = cut.kept
    attach_playback(
        piece, cut.playback, duration_ms=cut.playback_ms, start_ms=kept_start, end_ms=kept_end
    )
    attach_peaks(piece, cut.peaks)
    piece.state = "ready"
    piece.error = None
    await reclamp_recording_loops(session, piece, utc_now())
    bump_server_seq(piece)
    # A trim saved on the piece while it was cut is queued against its new slice.
    await ensure_trim_job(session, piece)


def _piece_range(piece: Recording, *, low: int, high: int) -> tuple[int, int]:
    """The piece's trim, clamped into the parent's original range."""
    requested_end = piece.trim_end_ms if piece.trim_end_ms is not None else high
    start_ms, end_ms = clamp_trim(piece.trim_start_ms, requested_end, low=low, high=high)
    return start_ms, high if end_ms is None else end_ms


async def cut_piece(
    session: AsyncSession, files: ParentFiles, parent: Recording, piece: Recording
) -> None:
    """Give one waiting piece its own original slice, playback file, and peaks.

    The slice is a stream copy of the piece's range out of the parent's full original,
    so the piece's original is bit-exact audio, and starts where the slice decodes from
    on the parent's source timeline. If the piece was deleted while the cut ran, or its
    trim widened past the cut, its uploads are deleted and the row is left as it was:
    a widened piece stays processing for the next cut.

    Args:
        session: The session the piece is attached to. The caller commits.
        files: The parent's files this attempt reads.
        parent: The ready parent whose original covers the piece.
        piece: A live piece of the parent's split, still processing.
    """
    _, low, high = _parent_original(parent)
    start_ms, end_ms = _piece_range(piece, low=low, high=high)
    uploaded: list[str] = []
    try:
        cut = await _cut_and_upload(
            files, parent, piece, kept=(start_ms, end_ms), uploaded=uploaded
        )
        # The lock keeps this seq in commit order with the user's pushes. The refresh
        # drops the offset set for the cut, so a skipped piece keeps its stored row.
        with session.no_autoflush:
            await lock_user(session, piece.user_id)
            await session.refresh(
                piece,
                attribute_names=[
                    "trim_start_ms",
                    "trim_end_ms",
                    "deleted_at",
                    "state",
                    "source_offset_ms",
                ],
            )
        # Compared with the range asked of the cut, not the range it kept: a re-encoded
        # slice can measure a few ms short, and a cut again would come out the same.
        now_start, now_end = _piece_range(piece, low=low, high=high)
        if (
            piece.deleted_at is not None
            or piece.state != "processing"
            or now_start < start_ms
            or now_end > end_ms
        ):
            await delete_best_effort(
                files.store, uploaded, log=log, message="could not delete a skipped piece's cut"
            )
            return
        await _attach_cut(session, piece, cut)
        await session.flush()
    except BaseException:
        await delete_best_effort(
            files.store, uploaded, log=log, message="could not delete an orphaned piece cut"
        )
        raise


def _kept_range(parent: Recording, pieces_start: int | None) -> tuple[int, int | None]:
    """The part of the parent's original its own slice keeps once the split completes.

    From the parent's trim start to where its split's first piece starts, or to the
    parent's trim end when that reaches further, so a trim saved on the parent after the
    split never removes audio from its original.
    """
    _, low, high = _parent_original(parent)
    end = effective_end(parent)
    if pieces_start is not None:
        end = pieces_start if end is None else max(end, pieces_start)
    return clamp_trim(parent.trim_start_ms, end, low=low, high=high)


@dataclass(frozen=True)
class _ParentSlice:
    """The parent's own range, cut from its full original and uploaded, not yet on its row."""

    original: Revision
    offset_ms: int
    length_ms: int


async def _cut_parent_slice(
    files: ParentFiles,
    parent: Recording,
    kept: tuple[int, int],
    uploaded: list[str],
) -> _ParentSlice:
    """Stream copy the parent's kept range out of its full original and upload it."""
    full, low, _ = _parent_original(parent)
    source = await files.source(full)
    target = files.work_dir / "parent-slice"
    start_ms, end_ms = kept
    sliced = await copy_slice(
        source.path,
        target,
        start_ms - low,
        end_ms - low,
        info=source.info,
        stalls=source.stalls,
    )
    original = await _upload_original_slice(
        files.store, parent, target, slice_content_type(source.info), uploaded
    )
    return _ParentSlice(original, low + sliced.start_ms, sliced.info.duration_ms)


async def complete_split(
    session: AsyncSession, files: ParentFiles, parent: Recording
) -> str | None:
    """Record the parent's split as completed and narrow its original to its own range.

    Runs once every piece of the split has its own slice, so nothing else needs the
    audio outside the parent's range: from its trim start to where its first piece starts,
    or to its trim end when that reaches further. The full original is returned rather than deleted:
    it must stay until the caller's commit stops naming it. A soft-deleted parent is
    only marked completed; the purge sweep removes its whole original.

    Under the user's lock, nothing is written when a live piece has no slice of its
    own, or when the parent's range, split, or original changed while its slice was cut.
    The split then stays uncompleted and the caller's `ensure_split_job` queues it again
    when it can complete.

    Args:
        session: The session the parent is attached to. The caller commits.
        files: The parent's files this attempt reads.
        parent: The ready parent whose split is complete.

    Returns:
        str | None: The superseded original's key, to delete after the commit, or None
            when the original was kept.
    """
    full, low, high = _parent_original(parent)
    start_ms, end_ms = _kept_range(parent, await split_pieces_start(session, parent))
    requested = (start_ms, end_ms, parent.split_id, full)
    uploaded: list[str] = []
    try:
        cut: _ParentSlice | None = None
        if parent.deleted_at is None and end_ms is not None and (start_ms, end_ms) != (low, high):
            cut = await _cut_parent_slice(files, parent, (start_ms, end_ms), uploaded)
        await lock_user(session, parent.user_id)
        await session.refresh(
            parent,
            attribute_names=[
                "trim_start_ms",
                "trim_end_ms",
                "split_id",
                "split_size",
                "split_completed_id",
                "original_key",
            ],
        )
        current = (
            *_kept_range(parent, await split_pieces_start(session, parent)),
            parent.split_id,
            parent.original_key,
        )
        if current != requested or not await split_ready_to_complete(session, parent):
            log.info(
                "split not completed: the parent or its pieces changed",
                extra={"recording": str(parent.id)},
            )
            await delete_best_effort(
                files.store, uploaded, log=log, message="could not delete an unused slice"
            )
            return None
        parent.split_completed_id = parent.split_id
        bump_server_seq(parent)
        if cut is not None:
            parent.original_key = cut.original.key
            parent.original_bytes = cut.original.size
            parent.source_offset_ms = cut.offset_ms
            parent.source_duration_ms = cut.offset_ms + cut.length_ms
            clamp_stored_trim(parent, high=parent.source_duration_ms)
        await session.flush()
    except BaseException:
        await delete_best_effort(
            files.store, uploaded, log=log, message="could not delete an orphaned original slice"
        )
        raise
    return full if cut is not None else None
