"""Re-cuts a recording's playback file from its original at the current playback bit rate."""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING

from crosstune.db.locks import lock_user
from crosstune.jobs.media import playback_bitrate, probe
from crosstune.jobs.recut import recut_playback
from crosstune.recordings.service import attach_playback, bump_server_seq
from crosstune.storage.store import delete_best_effort

if TYPE_CHECKING:
    import uuid
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore

log = logging.getLogger(__name__)

# A playback file this close to its target already sounds as good as a re-cut would.
CLOSE_TO_TARGET = 0.9
# The encoder can fall short of its target, most on stereo near 320 kbps, so a cut
# must measurably beat the current file to be worth every client downloading it again.
WORTH_REPLACING = 1.1


class ReencodeError(Exception):
    """The recording has no original or no complete range to re-cut from."""


def _log_outcome(recording_id: uuid.UUID, outcome: str, **rates: int | None) -> None:
    log.info(
        "re-encode finished",
        extra={"recording": str(recording_id), "outcome": outcome, **rates},
    )


@dataclass(frozen=True)
class Replacement:
    """A new playback file flushed to the session but not yet committed."""

    recording_id: uuid.UUID
    superseded_key: str
    rates: dict[str, int | None]

    def log_committed(self) -> None:
        """Log the replacement. Call only once the caller's commit has landed."""
        _log_outcome(self.recording_id, "replaced", **self.rates)


def _row_bit_rate(recording: Recording) -> int | None:
    """Read the playback file's bits per second from its size and duration on the row."""
    size, duration_ms = recording.playback_bytes, recording.duration_ms
    if size is None or not duration_ms:
        return None
    return size * 8 * 1000 // duration_ms


async def reencode(
    session: AsyncSession, store: ObjectStore, recording: Recording, work_dir: Path
) -> Replacement | None:
    """Re-cut the playback file of a ready recording from its original over the same range.

    Lifts a playback file encoded below what its original supports. A file already
    near its target, a file whose rate the row does not record, or a cut that measures
    no better than it, is left alone with no write and no new server_seq. The target
    never exceeds the original's own rate, so a file copied from a low-rate original is
    never re-encoded to no gain.

    A trim, a delete, or a new playback file can land while the cut runs with no lock
    held. If any did by the time the lock is taken, the cut is stale: its upload is
    deleted and the row keeps its current files.

    Args:
        session: The session the recording is attached to. The caller commits.
        store: Where the recording's files live and the new one goes.
        recording: A ready recording with an original.
        work_dir: A directory for temp files, cleaned by the caller.

    Returns:
        Replacement | None: The pending replacement, whose superseded key the caller
        deletes and whose outcome it logs only after its commit, or None when the row
        is unchanged. Every other outcome is logged here, since none waits on a commit.

    Raises:
        ReencodeError: The row has no original, no playback file, or no complete range.
    """
    original = recording.original_key
    current_key = recording.playback_key
    start_ms, end_ms = recording.playback_start_ms, recording.playback_end_ms
    if original is None or current_key is None or start_ms is None or end_ms is None:
        msg = (
            f"recording {recording.id} has nothing to re-cut: original={original}, "
            f"playback={current_key}, range={start_ms}-{end_ms}"
        )
        raise ReencodeError(msg)
    requested_trim = (recording.trim_start_ms, recording.trim_end_ms)
    state = recording.state
    current = _row_bit_rate(recording)
    if current is None:
        _log_outcome(recording.id, "unmeasured")
        return None

    source = work_dir / "original"
    await store.download(original, source)
    source_info = await probe(source)
    target = playback_bitrate(source_info.channels, source_info.bit_rate)
    if source_info.bit_rate is not None:
        target = min(target, source_info.bit_rate)
    rates = {
        "source_bps": source_info.bit_rate,
        "current_bps": current,
        "target_bps": target,
    }
    if current >= CLOSE_TO_TARGET * target:
        _log_outcome(recording.id, "near_target", **rates)
        return None

    uploaded: list[str] = []
    try:
        playback, cut_info = await recut_playback(
            store,
            recording,
            source=source,
            kept=(start_ms, end_ms),
            target=work_dir / "playback.m4a",
            uploaded=uploaded,
            source_info=source_info,
        )
        cut = cut_info.bit_rate
        if cut is None or cut < WORTH_REPLACING * current:
            await delete_best_effort(
                store, uploaded, log=log, message="could not delete a re-cut no better than before"
            )
            _log_outcome(recording.id, "no_better", **rates, cut_bps=cut)
            return None
        # The lock is what keeps this seq in commit order with the user's pushes; the
        # caller's commit releases it.
        await lock_user(session, recording.user_id)
        await session.refresh(
            recording,
            attribute_names=["trim_start_ms", "trim_end_ms", "deleted_at", "playback_key", "state"],
        )
        stale = (
            (recording.trim_start_ms, recording.trim_end_ms) != requested_trim
            or recording.deleted_at is not None
            or recording.playback_key != current_key
            or recording.state != state
        )
        if stale:
            await delete_best_effort(
                store, uploaded, log=log, message="could not delete a stale re-cut"
            )
            _log_outcome(recording.id, "stale", **rates, cut_bps=cut)
            return None
        attach_playback(
            recording, playback, duration_ms=cut_info.duration_ms, start_ms=start_ms, end_ms=end_ms
        )
        bump_server_seq(recording)
        await session.flush()
    except BaseException:
        # The caller rolls the row back, but this object is already in the bucket and
        # nothing will ever reference it. A cancelled job cleans up too.
        await delete_best_effort(
            store, uploaded, log=log, message="could not delete an orphaned re-cut"
        )
        raise
    return Replacement(recording.id, current_key, {**rates, "cut_bps": cut})
