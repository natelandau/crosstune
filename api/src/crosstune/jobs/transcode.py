"""One transcode from the uploaded object to the playback file, with the original kept cold."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.jobs.media import encode, needs_encode, probe, remux
from crosstune.recordings.service import bump_server_seq
from crosstune.storage.store import PLAYBACK_MIME, original_key, playback_key, upload_key

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.models import Recording
    from crosstune.storage.store import ObjectStore


async def transcode(
    session: AsyncSession, store: ObjectStore, recording: Recording, work_dir: Path
) -> None:
    """Produce the playback file for one uploaded recording and mark it ready.

    The uploaded object is left in the bucket: it is what a retry reads, and the
    caller deletes it once the row is committed.

    A failure partway through can leave `original_key` and `original_bytes` set on
    the in-memory row without a matching commit; the caller must refresh the row
    from the database before persisting a failure state.

    Args:
        session: The session the recording is attached to. The caller commits.
        store: Where the uploaded object lives and the results go.
        recording: A recording in the uploaded or processing state.
        work_dir: A directory for temp files, cleaned by the caller.
    """
    source_key = upload_key(recording.user_id, recording.id)
    source = work_dir / "upload"
    target = work_dir / "playback.m4a"
    await store.download(source_key, source)
    info = await probe(source)

    if needs_encode(info):
        await encode(source, target)
        uploaded = await store.head(source_key)
        content_type = uploaded.content_type if uploaded else "application/octet-stream"
        kept = original_key(recording.user_id, recording.id, content_type)
        await store.copy(source_key, kept, infrequent_access=True)
        recording.original_key = kept
        recording.original_bytes = source.stat().st_size
    else:
        await remux(source, target)
        recording.original_key = None
        recording.original_bytes = None

    result = await probe(target)
    key = playback_key(recording.user_id, recording.id)
    recording.playback_bytes = await store.upload(target, key, PLAYBACK_MIME)
    recording.playback_key = key
    recording.playback_mime = PLAYBACK_MIME
    recording.duration_ms = result.duration_ms
    recording.state = "ready"
    recording.error = None
    bump_server_seq(recording)
    await session.flush()
