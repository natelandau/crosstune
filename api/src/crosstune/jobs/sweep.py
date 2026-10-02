"""Bucket and row cleanup the job runner does between jobs: purges, abandoned uploads, orphans."""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import ARRAY, Uuid, and_, any_, delete, exists, literal, or_, select

from crosstune.db.locks import lock_user
from crosstune.models import Recording, UploadSlot, User
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq
from crosstune.storage.store import is_revision_key, recording_prefix, upload_key

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


def _owned_prefixes(
    keys: list[str],
) -> tuple[dict[uuid.UUID, str], dict[tuple[uuid.UUID, uuid.UUID], str]]:
    """Group keys by the user and recording ids their first two segments name.

    A segment that is not a UUID is not ours, so no prefix is built from it, and a
    key with a single segment belongs to no user.

    Returns:
        tuple: The user prefixes by user id, and the recording prefixes by
        (user id, recording id).
    """
    users: dict[uuid.UUID, str] = {}
    recordings: dict[tuple[uuid.UUID, uuid.UUID], str] = {}
    for key in keys:
        user_segment, has_user, rest = key.partition("/")
        user_id = _as_uuid(user_segment) if has_user else None
        if user_id is None:
            continue
        users.setdefault(user_id, f"{user_segment}/")
        recording_segment, has_recording, _ = rest.partition("/")
        recording_id = _as_uuid(recording_segment) if has_recording else None
        if recording_id is not None:
            recordings.setdefault((user_id, recording_id), f"{user_segment}/{recording_segment}/")
    return users, recordings


async def _lock_users(session: AsyncSession, recordings: Iterable[Recording]) -> None:
    """Take every affected user's lock in one fixed order, so two sweeps cannot wait on each other."""
    for user_id in sorted({recording.user_id for recording in recordings}):
        await lock_user(session, user_id)


async def sweep_orphans(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore, *, stray_after: timedelta
) -> int:
    """Delete every bucket object no row will ever name again.

    Account deletion removes the row first and wipes the bucket best-effort
    afterwards; this sweep is what makes the wipe certain. A user row exists
    before any key is issued under its id, a recording row before any upload
    URL under its id, and ids are never reused, so a UUID prefix with no row
    is always garbage. Other prefixes are not ours to touch.

    Inside a live recording's prefix, a playback or peaks revision the row does not
    name is garbage too once it is older than `stray_after`: every job attempt mints
    its own revision keys and only that attempt's commit names them, so one older
    than any attempt can run was left by an attempt that failed, was cancelled, or
    died before it could clean up. Originals and uploads are left alone, since jobs
    rewrite those keys in place and a sweep could race the write.

    One listing and two queries per sweep, however many users the bucket holds.

    Args:
        sessionmaker: Opens the read-only session the row checks use.
        store: The bucket to sweep.
        stray_after: How old an unnamed revision must be before no attempt can still
            commit it; at least the longest a job attempt can run.

    Returns:
        int: How many prefixes and stray revisions were removed.
    """
    objects = await store.list_objects()
    users, recordings = _owned_prefixes([obj.key for obj in objects])
    if not users:
        return 0
    async with sessionmaker() as session:
        live = set(await session.scalars(select(User.id).where(User.id == _any_uuid(users))))
        candidates = {pair: prefix for pair, prefix in recordings.items() if pair[0] in live}
        known: set[tuple[uuid.UUID, uuid.UUID]] = set()
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
    orphans = [prefix for user_id, prefix in users.items() if user_id not in live]
    orphans += [prefix for pair, prefix in candidates.items() if pair not in known]
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
        int: How many slots were released.
    """
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
        return len(rows)


async def purge_deleted(sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore) -> int:
    """Remove the files of soft-deleted recordings and leave their rows ready to upload again.

    Returns:
        int: How many recordings were swept.
    """
    has_slot = exists().where(UploadSlot.recording_id == Recording.id)
    stmt = (
        select(Recording)
        .where(
            Recording.deleted_at.is_not(None),
            or_(
                Recording.playback_key.is_not(None),
                Recording.original_key.is_not(None),
                Recording.state != "pending_upload",
                # A slot means a PUT may have landed that no /uploaded call will ever claim.
                has_slot,
            ),
        )
        .limit(PURGE_BATCH)
    )
    async with sessionmaker() as session:
        async with session.begin():
            rows = list(await session.scalars(stmt))
        if not rows:
            return 0
        # Delete every object before touching any row, so a commit that fails
        # partway is retried by the next sweep against already-gone objects.
        # The prefix also catches objects the row never named: a playback file
        # written after the row was read, or an original copied by a transcode
        # that failed before it could commit the key.
        await asyncio.gather(
            *(
                store.delete_prefix(recording_prefix(recording.user_id, recording.id))
                for recording in rows
            )
        )
        async with session.begin():
            # The row updates draw a server_seq each, so they run under every affected
            # user's lock, taken only now, so no push waits on the bucket.
            await _lock_users(session, rows)
            await session.execute(
                delete(UploadSlot).where(UploadSlot.recording_id.in_([r.id for r in rows]))
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
