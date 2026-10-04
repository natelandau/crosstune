"""Bucket and row cleanup the job runner does between jobs: purges, abandoned uploads, orphans."""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import ARRAY, Uuid, and_, any_, delete, exists, literal, or_, select

from crosstune.db.locks import advisory_lock_key, lock_user
from crosstune.models import Recording, Scan, UploadSlot, User
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq
from crosstune.scans.service import bump_scan_server_seq
from crosstune.storage.store import (
    LEGACY_SCAN_SEGMENT,
    SCAN_SEGMENT,
    is_revision_key,
    legacy_scan_key,
    recording_prefix,
    scan_key,
    scan_prefix,
    scan_prefixes,
    upload_key,
)
from crosstune.vocabulary import ScanState

if TYPE_CHECKING:
    from collections.abc import Iterable

    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.storage.store import ObjectStore

PURGE_BATCH = 20
# A PUT signed just before its slot expired can still be arriving; past this it is abandoned.
ABANDONED_SLOT_GRACE = timedelta(hours=1)


def live_pending_slot() -> ColumnElement[bool]:
    """Match the slots of live recordings still waiting on their upload."""
    return and_(Recording.deleted_at.is_(None), Recording.state == "pending_upload")


def live_pending_scan_slot() -> ColumnElement[bool]:
    """Match the slots of live scans still waiting on their upload."""
    return and_(
        Scan.deleted_at.is_(None),
        Scan.state == ScanState.PENDING_UPLOAD.value,
    )


def _any_uuid(ids: Iterable[uuid.UUID]) -> ColumnElement[Any]:
    """Match against a whole id set bound as one array, since asyncpg caps bind parameters."""
    return any_(literal(list(ids), ARRAY(Uuid())))


def _as_uuid(segment: str) -> uuid.UUID | None:
    try:
        return uuid.UUID(segment)
    except ValueError:
        return None


def _recording_of(key: str) -> tuple[uuid.UUID, uuid.UUID] | None:
    """The (user id, recording id) a key's first two segments name, if both are ours."""
    user_segment, _, rest = key.partition("/")
    recording_segment, has_recording, _ = rest.partition("/")
    user_id = _as_uuid(user_segment)
    recording_id = _as_uuid(recording_segment) if has_recording else None
    if user_id is None or recording_id is None:
        return None
    return user_id, recording_id


type _Prefixes = dict[tuple[uuid.UUID, uuid.UUID], str]


def _owned_prefixes(
    keys: list[str],
) -> tuple[dict[uuid.UUID, str], _Prefixes, dict[str, tuple[uuid.UUID, uuid.UUID]]]:
    """Group keys by the user, recording, and scan ids their segments name.

    A segment that is not a UUID is not ours, so no prefix is built from it, and a
    key with a single segment belongs to no user. A scan's id is the third segment,
    after SCAN_SEGMENT or LEGACY_SCAN_SEGMENT, so one scan can own two prefixes.

    Returns:
        tuple: The user prefixes by user id, the recording prefixes by
        (user id, recording id), and the (user id, scan id) each scan prefix names.
    """
    users: dict[uuid.UUID, str] = {}
    recordings: _Prefixes = {}
    scans: dict[str, tuple[uuid.UUID, uuid.UUID]] = {}
    for key in keys:
        user_segment, has_user, rest = key.partition("/")
        user_id = _as_uuid(user_segment) if has_user else None
        if user_id is None:
            continue
        users.setdefault(user_id, f"{user_segment}/")
        second, has_second, rest = rest.partition("/")
        if not has_second:
            continue
        if second in (SCAN_SEGMENT, LEGACY_SCAN_SEGMENT):
            scan_segment, has_scan, _ = rest.partition("/")
            scan_id = _as_uuid(scan_segment) if has_scan else None
            if scan_id is not None:
                scans.setdefault(
                    scan_prefix(user_segment, scan_segment, second), (user_id, scan_id)
                )
            continue
        recording_id = _as_uuid(second)
        if recording_id is not None:
            recordings.setdefault((user_id, recording_id), f"{user_segment}/{second}/")
    return users, recordings, scans


async def _lock_users(session: AsyncSession, rows: Iterable[Recording | Scan]) -> None:
    """Take every affected user's lock in lock-key order, so nothing else locking many users waits on it."""
    for user_id in sorted({row.user_id for row in rows}, key=advisory_lock_key):
        await lock_user(session, user_id)


async def sweep_orphans(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore, *, stray_after: timedelta
) -> int:
    """Delete every bucket object no row will ever name again.

    Account deletion removes the row first and wipes the bucket best-effort
    afterwards; this sweep is what makes the wipe certain. A user row exists
    before any key is issued under its id, a recording or scan row
    before any upload URL under its id, and ids are never reused, so a UUID
    prefix with no row is always garbage. Other prefixes are not ours to touch.

    Inside a live recording's prefix, a playback or peaks revision the row does not
    name is garbage too once it is older than `stray_after`: every job attempt mints
    its own revision keys and only that attempt's commit names them, so one older
    than any attempt can run was left by an attempt that failed, was cancelled, or
    died before it could clean up. Originals and uploads are left alone, since jobs
    rewrite those keys in place and a sweep could race the write.

    One listing and three queries per sweep, however many users the bucket holds.

    Args:
        sessionmaker: Opens the read-only session the row checks use.
        store: The bucket to sweep.
        stray_after: How old an unnamed revision must be before no attempt can still
            commit it; at least the longest a job attempt can run.

    Returns:
        int: How many prefixes and stray revisions were removed.
    """
    objects = await store.list_objects()
    users, recordings, scans = _owned_prefixes([obj.key for obj in objects])
    if not users:
        return 0
    async with sessionmaker() as session:
        live = set(await session.scalars(select(User.id).where(User.id == _any_uuid(users))))
        candidates = {pair: prefix for pair, prefix in recordings.items() if pair[0] in live}
        scan_candidates = {prefix: pair for prefix, pair in scans.items() if pair[0] in live}
        known: set[tuple[uuid.UUID, uuid.UUID]] = set()
        known_scans: set[tuple[uuid.UUID, uuid.UUID]] = set()
        named: set[str] = set()
        if candidates:
            rows = await session.execute(
                select(
                    Recording.user_id, Recording.id, Recording.playback_key, Recording.peaks_key
                ).where(Recording.id == _any_uuid(recording_id for _, recording_id in candidates))
            )
            for user_id, recording_id, playback, peaks in rows.tuples():
                known.add((user_id, recording_id))
                named.update(key for key in (playback, peaks) if key is not None)
        if scan_candidates:
            scan_rows = await session.execute(
                select(Scan.user_id, Scan.id).where(
                    Scan.id == _any_uuid({scan_id for _, scan_id in scan_candidates.values()})
                )
            )
            known_scans.update(scan_rows.tuples())
    orphans = [prefix for user_id, prefix in users.items() if user_id not in live]
    orphans += [prefix for pair, prefix in candidates.items() if pair not in known]
    orphans += [prefix for prefix, pair in scan_candidates.items() if pair not in known_scans]
    cutoff = utc_now() - stray_after
    strays = [
        obj.key
        for obj in objects
        if is_revision_key(obj.key)
        and obj.key not in named
        and obj.modified < cutoff
        and _recording_of(obj.key) in known
    ]
    await asyncio.gather(*(store.delete_prefix(prefix) for prefix in orphans))
    if strays:
        await store.delete(*strays)
    return len(orphans) + len(strays)


async def release_abandoned_slots(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    """Delete what an upload slot that was never confirmed may have left in the bucket.

    An expired slot stops counting against the quota, so an object PUT under it and
    never confirmed would otherwise stay in the bucket uncounted.

    Returns:
        int: How many recording and scan slots were released.
    """
    released = await _release_recording_slots(sessionmaker, store)
    return released + await _release_scan_slots(sessionmaker, store)


async def _release_recording_slots(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    stmt = (
        select(Recording)
        .join(UploadSlot, UploadSlot.recording_id == Recording.id)
        .where(UploadSlot.expires_at < cutoff, live_pending_slot())
        .limit(PURGE_BATCH)
    )
    async with sessionmaker() as session:
        async with session.begin():
            rows = list(await session.scalars(stmt))
        if not rows:
            return 0
        await store.delete(*(upload_key(r.user_id, r.id) for r in rows))
        async with session.begin():
            await _lock_users(session, rows)
            # Re-checked under the locks, so a slot reissued meanwhile stays open and its
            # recording, which a confirmation may already have moved on, is left alone.
            released = set(
                await session.scalars(
                    delete(UploadSlot)
                    .where(
                        UploadSlot.recording_id.in_([r.id for r in rows]),
                        UploadSlot.expires_at < cutoff,
                    )
                    .returning(UploadSlot.recording_id)
                )
            )
            for recording in rows:
                # A failed upload's object was counted through playback_bytes, and is gone.
                if recording.id in released and recording.playback_bytes is not None:
                    recording.playback_bytes = None
                    bump_server_seq(recording)
        return len(released)


async def _release_scan_slots(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    """Delete the image an abandoned scan slot may have left, and the slot.

    A scan's upload key is also the key it is served from, so unlike a recording's
    upload the object cannot be deleted before the re-check: a slot reissued and
    confirmed in between would lose its image. The re-check, the delete, and the
    slot removal all happen under the users' locks, which every reissue and
    confirmation also takes, and a failed delete rolls the slot removal back.
    """
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    stmt = (
        select(Scan)
        .join(UploadSlot, UploadSlot.scan_id == Scan.id)
        .where(UploadSlot.expires_at < cutoff, live_pending_scan_slot())
        .limit(PURGE_BATCH)
    )
    async with sessionmaker() as session:
        async with session.begin():
            rows = list(await session.scalars(stmt))
        if not rows:
            return 0
        async with session.begin():
            await _lock_users(session, rows)
            abandoned = set(
                await session.scalars(
                    select(UploadSlot.scan_id).where(
                        UploadSlot.scan_id.in_([scan.id for scan in rows]),
                        UploadSlot.expires_at < cutoff,
                    )
                )
            )
            if abandoned:
                await store.delete(
                    *(
                        key
                        for scan in rows
                        if scan.id in abandoned
                        for key in (
                            scan_key(scan.user_id, scan.id),
                            legacy_scan_key(scan.user_id, scan.id),
                        )
                    )
                )
                await session.execute(delete(UploadSlot).where(UploadSlot.scan_id.in_(abandoned)))
        return len(abandoned)


async def purge_deleted(sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore) -> int:
    """Remove the files of soft-deleted recordings and leave their rows ready to upload again.

    A deleted recording's upload slot is kept until it passes ABANDONED_SLOT_GRACE, since
    a PUT signed under it can still land after the first purge; the slot then brings the
    row back for one more prefix delete, which collects that late object.

    The rows are re-read under the users' locks and only then is any file deleted, so a
    recording a client un-deleted and uploaded again meanwhile keeps its file.

    Returns:
        int: How many recordings were swept.
    """
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    abandoned_slot = exists().where(
        UploadSlot.recording_id == Recording.id, UploadSlot.expires_at < cutoff
    )
    purgeable = (
        Recording.deleted_at.is_not(None),
        or_(
            Recording.playback_key.is_not(None),
            Recording.original_key.is_not(None),
            Recording.state != "pending_upload",
            # No PUT can land under it any more, and one may have landed that no
            # /uploaded call will ever claim.
            abandoned_slot,
        ),
    )
    async with sessionmaker() as session:
        async with session.begin():
            candidates = list(
                await session.scalars(select(Recording).where(*purgeable).limit(PURGE_BATCH))
            )
        if not candidates:
            return 0
        async with session.begin():
            await _lock_users(session, candidates)
            rows = list(
                await session.scalars(
                    select(Recording)
                    .where(Recording.id.in_([r.id for r in candidates]), *purgeable)
                    .execution_options(populate_existing=True)
                )
            )
            if not rows:
                return 0
            # The prefix also catches objects the row never named: a playback file
            # written after the row was read, or an original copied by a transcode
            # that failed before it could commit the key. A failed delete rolls the
            # row changes back, so the next sweep retries both.
            await asyncio.gather(
                *(
                    store.delete_prefix(recording_prefix(recording.user_id, recording.id))
                    for recording in rows
                )
            )
            await session.execute(
                delete(UploadSlot).where(
                    UploadSlot.recording_id.in_([r.id for r in rows]),
                    UploadSlot.expires_at < cutoff,
                )
            )
            for recording in rows:
                recording.playback_key = None
                recording.original_key = None
                recording.playback_bytes = None
                recording.original_bytes = None
                recording.error = None
                # A row that a client un-deletes must upload again; it has no file any more.
                recording.state = "pending_upload"
                bump_server_seq(recording)
        return len(rows)


async def purge_deleted_scans(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    """Remove the images of soft-deleted scans and leave their rows ready to upload again.

    A scan tombstoned while its upload was being confirmed can still turn ready
    afterwards; its state alone makes the next sweep pick it up. A scan's slot is kept
    until it passes ABANDONED_SLOT_GRACE, as in purge_deleted, so an image PUT after
    the first purge is collected by a later one.

    The rows are re-read under the users' locks and only then is any image deleted,
    so a scan a client un-deleted and uploaded again meanwhile keeps its image.

    Returns:
        int: How many scans were swept.
    """
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    abandoned_slot = exists().where(UploadSlot.scan_id == Scan.id, UploadSlot.expires_at < cutoff)
    purgeable = (
        Scan.deleted_at.is_not(None),
        or_(
            Scan.file_key.is_not(None),
            Scan.state != ScanState.PENDING_UPLOAD.value,
            abandoned_slot,
        ),
    )
    async with sessionmaker() as session:
        async with session.begin():
            candidates = list(
                await session.scalars(select(Scan).where(*purgeable).limit(PURGE_BATCH))
            )
        if not candidates:
            return 0
        async with session.begin():
            await _lock_users(session, candidates)
            rows = list(
                await session.scalars(
                    select(Scan)
                    .where(Scan.id.in_([scan.id for scan in candidates]), *purgeable)
                    .execution_options(populate_existing=True)
                )
            )
            if not rows:
                return 0
            # A failed delete rolls the row changes back, so the next sweep retries both.
            await asyncio.gather(
                *(
                    store.delete_prefix(prefix)
                    for scan in rows
                    for prefix in scan_prefixes(scan.user_id, scan.id)
                )
            )
            await session.execute(
                delete(UploadSlot).where(
                    UploadSlot.scan_id.in_([scan.id for scan in rows]),
                    UploadSlot.expires_at < cutoff,
                )
            )
            for scan in rows:
                scan.file_key = None
                scan.file_bytes = None
                scan.state = ScanState.PENDING_UPLOAD.value
                bump_scan_server_seq(scan)
        return len(rows)
