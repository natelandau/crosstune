"""Cuts a new playback file from a local copy of a recording's original and uploads it."""

from __future__ import annotations

from functools import partial
from typing import TYPE_CHECKING

from crosstune.jobs.media import cut, probe
from crosstune.storage.store import PLAYBACK_MIME, playback_key, upload_revision

if TYPE_CHECKING:
    from pathlib import Path

    from crosstune.jobs.media import Probe
    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore, Revision


async def recut_playback(
    store: ObjectStore,
    recording: Recording,
    *,
    source: Path,
    kept: tuple[int, int],
    target: Path,
    uploaded: list[str],
    source_info: Probe | None = None,
) -> tuple[Revision, Probe]:
    """Cut the original to the kept range and upload it as a new playback revision.

    The key is appended to `uploaded` before its upload starts, so the caller can
    delete what this attempt left behind if anything after it fails.

    Args:
        store: Where the new playback file goes.
        recording: The recording the files belong to.
        source: A local copy of the recording's original.
        kept: The start and end of the kept range, in milliseconds on the source timeline.
        target: Where the cut is written, left for the caller to read.
        uploaded: Collects every key this call uploads to.
        source_info: The probe of `source`, when one has already read it.

    Returns:
        tuple[Revision, Probe]: The uploaded playback revision and the probe of the cut.
    """
    start_ms, end_ms = kept
    # The kept range is on the source timeline, which is the original's own timeline.
    await cut(source, target, start_ms, end_ms, info=source_info)
    info = await probe(target)
    playback = await upload_revision(
        store,
        target,
        PLAYBACK_MIME,
        partial(playback_key, recording.user_id, recording.id),
        uploaded=uploaded,
    )
    return playback, info
