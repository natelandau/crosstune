"""Fetch an imported recording's audio into its upload object and queue a transcode."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

from crosstune.db.base import bump_server_seq
from crosstune.db.locks import lock_user
from crosstune.files.quota import used_bytes
from crosstune.jobs.attempt import (
    attempt_timeout,
    fail_recording,
    load_claimed,
    load_locked,
    reload,
    still_claimed,
)
from crosstune.jobs.importer import IMPORT_MIME, OVER_QUOTA, ImportRefused, fetch_import
from crosstune.models import Job, Recording
from crosstune.recordings.service import enqueue_transcode
from crosstune.storage.store import upload_key
from crosstune.vocabulary import RecordingPrecision

if TYPE_CHECKING:
    import httpx2
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.jobs.attempt import JobContext
    from crosstune.jobs.importer import FetchedImport

log = logging.getLogger(__name__)


@dataclass
class _ImportWrite:
    """How far an import got toward its upload object, for cleanup after a failure."""

    key: str
    written: bool = False
    committing: bool = False
    committed: bool = False


async def run(ctx: JobContext, job: Job) -> None:
    """Fetch an imported recording's audio into its upload object and queue a transcode.

    The download and the bucket write run with no transaction open and no lock held,
    so the user's pushes never wait on Slippery-Hill or the bucket. Only then does a
    transaction take the user's lock, check the quota, and hand the recording to a
    transcode, so two imports can't both fit in the same free space. Any failure
    between the write and that commit deletes the object.
    """
    async with ctx.sessionmaker() as session:
        async with session.begin():
            prepared = await load_claimed(
                session, job, done=lambda recording: recording.deleted_at is not None
            )
        if prepared is None:
            return
        recording, _ = prepared
        write = _ImportWrite(key=upload_key(recording.user_id, recording.id))
        with ctx.work_dir() as folder:
            try:
                async with attempt_timeout():
                    path = Path(folder) / "import"
                    fetched = await fetch_import(
                        _client(ctx),
                        recording,
                        path,
                        max_bytes=ctx.settings.recording_max_file_bytes,
                        timeout=ctx.settings.link_resolve_timeout_seconds,
                    )
                    write.written = True
                    await ctx.store.upload(path, write.key, IMPORT_MIME)
                    await _commit(ctx, session, job, fetched, write)
            except asyncio.CancelledError:
                # A commit the cancel interrupted may have landed and queued a transcode
                # of this file, so only an upload that never reached a commit is removed.
                if write.written and not write.committing:
                    await ctx.delete_stale(write.key)
                raise
            except Exception as exc:  # noqa: BLE001 -- any import failure is a job failure, not a crash
                current: Recording | None = None
                async with session.begin():
                    current = await reload(session, Recording, job.recording_id)
                    stored_job = await reload(session, Job, job.id)
                    if current is not None and still_claimed(stored_job, job):
                        await _fail(session, stored_job, current, exc)
                if write.written:
                    await _discard_upload(ctx, current, write.key)
                return
        if write.written and not write.committed:
            async with session.begin():
                current = await reload(session, Recording, job.recording_id)
            await _discard_upload(ctx, current, write.key)


def _client(ctx: JobContext) -> httpx2.AsyncClient:
    if ctx.http_client is None:
        msg = "the job runner has no HTTP client for imports"
        raise RuntimeError(msg)
    return ctx.http_client


async def _commit(
    ctx: JobContext, session: AsyncSession, job: Job, fetched: FetchedImport, write: _ImportWrite
) -> None:
    """Under the user's lock, check the quota and hand the uploaded file to a transcode.

    Dates the recording from its page's year unless it already has a recorded date,
    which the user may have set while the file downloaded. Leaves `write.committed`
    false when the job is no longer this attempt's to finish.

    Raises:
        ImportRefused: When the file would take the user past their quota.
    """
    async with session.begin():
        prepared = await load_locked(session, job)
        if prepared is None:
            return
        recording, stored_job = prepared
        used = await used_bytes(session, recording.user_id, exclude=recording.id)
        if used + fetched.size > ctx.settings.storage_quota_bytes:
            raise ImportRefused(OVER_QUOTA)
        if fetched.year is not None and recording.recorded_at is None:
            recording.recorded_at = datetime(fetched.year, 1, 1, tzinfo=UTC)
            recording.recorded_precision = RecordingPrecision.YEAR.value
        recording.playback_bytes = fetched.size
        recording.state = "uploaded"
        recording.error = None
        bump_server_seq(recording)
        await session.delete(stored_job)
        await enqueue_transcode(session, recording)
        write.committing = True
    write.committed = True


async def _discard_upload(ctx: JobContext, recording: Recording | None, key: str) -> None:
    """Delete an import's upload object unless the row shows a landed commit using it.

    A commit that raised can still have landed, and another pass may have finished
    the job. Only that commit sets `playback_bytes`, and the transcode it queued may
    already have moved the row on to `processing` or `failed` while it still needs
    the file.
    """
    if recording is None or recording.playback_bytes is None:
        await ctx.delete_stale(key)


async def _fail(session: AsyncSession, job: Job, recording: Recording, exc: Exception) -> None:
    """Fail a refused import at once; retry anything else while it stays processing."""
    if not isinstance(exc, ImportRefused):
        await fail_recording(session, job, recording, exc, retry_state="processing")
        return
    log.info("import refused", extra={"recording": str(recording.id), "error": str(exc)})
    await lock_user(session, recording.user_id)
    recording.state = "failed"
    recording.error = str(exc)
    bump_server_seq(recording)
    await session.delete(job)
