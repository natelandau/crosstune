"""Backfills the waveform peaks file, and any unknown length, for a playback file that predates them."""

from __future__ import annotations

import logging
from functools import partial
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.media import probe
from crosstune.jobs.peaks import build_peaks
from crosstune.models.user import utc_now
from crosstune.recordings.loops import reclamp_recording_loops
from crosstune.recordings.service import attach_peaks, bump_server_seq
from crosstune.recordings.trim import clamp_stored_trim
from crosstune.storage.store import PEAKS_MIME, delete_best_effort, peaks_key, upload_revision

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)


async def build_recording_peaks(
    session: AsyncSession, store: ObjectStore, recording: Recording, work_dir: Path
) -> None:
    """Build and store waveform peaks from a recording's current playback file.

    Never touches the recording's state: this job only fills in what a transcode
    run before trims existed never recorded. That is always a peaks file, and for
    a recording whose length was never stored, the length and playback range too,
    without which it cannot be trimmed. A playback file from then was never cut,
    so its length is the source's. A trim saved while the length was unknown is
    clamped to it, the way a transcode clamps one saved before upload. If the playback
    file moves on to a newer revision while this runs, the peaks just built are
    for audio that no longer matters, so they are dropped instead of attached to
    the row. A failure between the upload and the row write also drops the object
    it made, rather than leaving it behind for nothing to ever reference.

    Args:
        session: The session the recording is attached to. The caller commits.
        store: Where the playback file lives and the peaks go.
        recording: A recording whose playback file is the one to draw peaks from.
        work_dir: A directory for temp files, cleaned by the caller.
    """
    if recording.playback_key is None:
        msg = "recording has no playback file to build peaks from"
        raise ValueError(msg)
    playback_key_used = recording.playback_key
    source = work_dir / "playback.m4a"
    await store.download(playback_key_used, source)
    measured_ms = (await probe(source)).duration_ms if recording.playback_end_ms is None else None
    peaks_path = work_dir / "peaks.bin"
    peaks_path.write_bytes(await build_peaks(source))
    peaks = await upload_revision(
        store, peaks_path, PEAKS_MIME, partial(peaks_key, recording.user_id, recording.id)
    )

    try:
        await lock_user(session, recording.user_id)
        await session.refresh(recording, attribute_names=["playback_key"])
        if recording.playback_key != playback_key_used:
            await delete_best_effort(
                store, [peaks.key], log=log, message="could not delete a superseded peaks object"
            )
            return
        attach_peaks(recording, peaks)
        if measured_ms is not None:
            await _store_length(session, recording, measured_ms)
        bump_server_seq(recording)
        await session.flush()
    except BaseException:
        # Whatever raised here, a cancellation included, leaves the row's own write
        # rolled back by the caller, but the object above is already in the bucket;
        # nothing else will ever come to reference it, so it goes now.
        await delete_best_effort(
            store, [peaks.key], log=log, message="could not delete an orphaned peaks object"
        )
        raise


async def _store_length(session: AsyncSession, recording: Recording, length_ms: int) -> None:
    """Record the length of an uncut playback file, and clamp a saved trim and loops to it.

    Reads the columns fresh under the user's lock the caller holds, so a trim pushed
    while this job ran is clamped rather than overwritten.
    """
    await session.refresh(
        recording, attribute_names=["playback_end_ms", "trim_start_ms", "trim_end_ms"]
    )
    if recording.playback_end_ms is not None:
        return
    recording.duration_ms = length_ms
    recording.source_duration_ms = length_ms
    recording.playback_start_ms = 0
    recording.playback_end_ms = length_ms
    clamp_stored_trim(recording, high=length_ms)
    await reclamp_recording_loops(session, recording, utc_now())
