"""Write a planned set of rows into an account, as a client's push and uploads would.

Pushing recordings and scans needs Premium, so the caller snapshots the account's
server-issued grants and gives it a temporary comp in the seed's transaction. The caller
restores the snapshot in a later transaction, once the transcodes have finished.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import delete, select, update

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp
from crosstune.models import Grant, Job, Recording, Scan
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.recordings.service import bump_server_seq, enqueue_transcode
from crosstune.storage.store import PLAYBACK_MIME, SCAN_MIME, scan_key, upload_key
from crosstune.sync.push import apply_push
from crosstune.vocabulary import (
    GrantSource,
    JobKind,
    RecordingSource,
    RecordingState,
    ScanState,
)

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from crosstune.models import User
    from crosstune.ops.testdata.fixture import Plan, PlannedFile
    from crosstune.storage.store import ObjectStore

GRANTED_BY = "testdata"
SEED_REASON = "seeding test data"
_SERVER_SOURCES = (GrantSource.TRIAL.value, GrantSource.COMP.value)
_AUDIO_TYPES = {".m4a": PLAYBACK_MIME}
_WAITING_STATES = (RecordingState.PENDING_UPLOAD, RecordingState.FAILED)


@dataclass(frozen=True)
class GrantSnapshot:
    """Every trial and comp grant a user held, with all of its column values."""

    rows: list[dict[str, Any]]


async def snapshot_server_grants(session: AsyncSession, user_id: uuid.UUID) -> GrantSnapshot:
    """Record the user's trial and comp grants so a seed's temporary comp can be undone.

    Returns:
        GrantSnapshot: The grants as they are now.
    """
    grants = await session.scalars(
        select(Grant)
        .where(Grant.user_id == user_id, Grant.source.in_(_SERVER_SOURCES))
        .execution_options(populate_existing=True)
    )
    columns = [column.key for column in Grant.__table__.columns]
    return GrantSnapshot(
        rows=[{column: getattr(grant, column) for column in columns} for grant in grants]
    )


async def restore_server_grants(
    session: AsyncSession,
    user_id: uuid.UUID,
    snapshot: GrantSnapshot,
    settings: Settings,
    now: datetime,
) -> None:
    """Put the user's trial and comp grants back as the snapshot recorded them.

    Removes any server grant the snapshot does not hold, such as a comp the seed created,
    then brings the entitlements row in line.
    """
    kept = [row["id"] for row in snapshot.rows]
    for row in snapshot.rows:
        await session.execute(
            update(Grant)
            .where(Grant.id == row["id"])
            .values(
                expires_at=row["expires_at"],
                granted_by=row["granted_by"],
                reason=row["reason"],
                updated_at=row["updated_at"],
            )
        )
    await session.execute(
        delete(Grant).where(
            Grant.user_id == user_id,
            Grant.source.in_(_SERVER_SOURCES),
            Grant.id.not_in(kept),
        )
    )
    await refresh_entitlement(session, user_id, settings, now)


async def grant_seed_comp(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime
) -> None:
    """Give the user open-ended Premium, so push accepts recordings and scans on any account."""
    await grant_comp(
        session,
        user_id,
        expires_at=None,
        storage_addon=False,
        granted_by=GRANTED_BY,
        reason=SEED_REASON,
        now=now,
    )
    await refresh_entitlement(session, user_id, settings, now)


async def seed_plan(
    session: AsyncSession, store: ObjectStore, user: User, plan: Plan, settings: Settings
) -> list[uuid.UUID]:
    """Push the plan's rows and upload their files, leaving recordings queued to transcode.

    The caller holds the comp that lets the push through, and commits.

    Args:
        session: The session to write through.
        store: The bucket the files go to.
        user: The account to seed.
        plan: The rows and files to write.
        settings: The plan sizes the push resolves the user's access against.

    Returns:
        list[uuid.UUID]: The recordings a transcode was queued for.

    Raises:
        DataCommandError: Push did not apply every planned row.
    """
    results = await apply_push(session, user.id, plan.changes, settings)
    refused = [
        f"{change.table} {result.id}: {result.status} {result.reason or ''}".rstrip()
        for change, result in zip(plan.changes, results, strict=True)
        if result.status != "applied"
    ]
    if refused:
        msg = "push refused planned rows:\n" + "\n".join(refused)
        raise DataCommandError(msg)

    enqueued = [
        planned.id
        for planned in plan.recordings
        if await _attach_recording(session, store, user.id, planned)
    ]
    for planned in plan.scans:
        await _attach_scan(session, store, user.id, planned)
    await session.flush()
    return enqueued


def _attachable(recording: Recording) -> bool:
    # A pushed import is left processing with its fetch queued; the others wait for a file.
    if recording.source == RecordingSource.IMPORT and recording.state == RecordingState.PROCESSING:
        return True
    return recording.state in _WAITING_STATES


async def _attach_recording(
    session: AsyncSession, store: ObjectStore, user_id: uuid.UUID, planned: PlannedFile
) -> bool:
    """Upload a recording's file and queue its transcode, as the uploaded route does.

    Returns:
        bool: True when a transcode was queued.
    """
    recording = await session.get(Recording, planned.id)
    if recording is None or not _attachable(recording):
        return False
    content_type = _AUDIO_TYPES.get(planned.path.suffix)
    if content_type is None:
        msg = f"{planned.path.name} is not one of the audio types {sorted(_AUDIO_TYPES)}"
        raise DataCommandError(msg)
    if recording.source == RecordingSource.IMPORT:
        # The local file replaces the import, so nothing fetches from Slippery-Hill.
        await session.execute(
            delete(Job).where(Job.recording_id == planned.id, Job.kind == JobKind.IMPORT.value)
        )
    recording.playback_bytes = await store.upload(
        planned.path, upload_key(user_id, planned.id), content_type=content_type
    )
    recording.state = RecordingState.UPLOADED.value
    recording.error = None
    bump_server_seq(recording)
    await enqueue_transcode(session, recording)
    return True


async def _attach_scan(
    session: AsyncSession, store: ObjectStore, user_id: uuid.UUID, planned: PlannedFile
) -> None:
    """Upload a scan's image and mark it ready, as the uploaded route does."""
    scan = await session.get(Scan, planned.id)
    if scan is None or scan.state == ScanState.READY:
        return
    key = scan_key(user_id, planned.id)
    scan.file_bytes = await store.upload(planned.path, key, content_type=SCAN_MIME)
    scan.file_key = key
    scan.state = ScanState.READY.value
    bump_server_seq(scan)
