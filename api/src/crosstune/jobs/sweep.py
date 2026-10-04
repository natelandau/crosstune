"""Bucket and row cleanup the job runner does between jobs: purges, abandoned uploads, orphans."""

from __future__ import annotations

import asyncio
import uuid
from datetime import timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import ARRAY, Uuid, and_, any_, delete, exists, literal, or_, select

from crosstune.db.locks import lock_user
from crosstune.models import NotationPage, Recording, UploadSlot, User
from crosstune.models.user import utc_now
from crosstune.notation.service import bump_page_server_seq
from crosstune.recordings.service import bump_server_seq
from crosstune.storage.store import (
    NOTATION_SEGMENT,
    is_revision_key,
    notation_key,
    notation_prefix,
    recording_prefix,
    upload_key,
)
from crosstune.vocabulary import NotationPageState

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


def live_pending_page_slot() -> ColumnElement[bool]:
    """Match the slots of live notation pages still waiting on their upload."""
    return and_(
        NotationPage.deleted_at.is_(None),
        NotationPage.state == NotationPageState.PENDING_UPLOAD.value,
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


def _owned_prefixes(keys: list[str]) -> tuple[dict[uuid.UUID, str], _Prefixes, _Prefixes]:
    """Group keys by the user, recording, and notation page ids their segments name.

    A segment that is not a UUID is not ours, so no prefix is built from it, and a
    key with a single segment belongs to no user. A page's id is the third segment,
    after NOTATION_SEGMENT.

    Returns:
        tuple: The user prefixes by user id, the recording prefixes by
        (user id, recording id), and the page prefixes by (user id, page id).
    """
    users: dict[uuid.UUID, str] = {}
    recordings: _Prefixes = {}
    pages: _Prefixes = {}
    for key in keys:
        user_segment, has_user, rest = key.partition("/")
        user_id = _as_uuid(user_segment) if has_user else None
        if user_id is None:
            continue
        users.setdefault(user_id, f"{user_segment}/")
        second, has_second, rest = rest.partition("/")
        if not has_second:
            continue
        if second == NOTATION_SEGMENT:
            page_segment, has_page, _ = rest.partition("/")
            page_id = _as_uuid(page_segment) if has_page else None
            if page_id is not None:
                pages.setdefault((user_id, page_id), notation_prefix(user_segment, page_segment))
            continue
        recording_id = _as_uuid(second)
        if recording_id is not None:
            recordings.setdefault((user_id, recording_id), f"{user_segment}/{second}/")
    return users, recordings, pages


async def _lock_users(session: AsyncSession, rows: Iterable[Recording | NotationPage]) -> None:
    """Take every affected user's lock in one fixed order, so two sweeps cannot wait on each other."""
    for user_id in sorted({row.user_id for row in rows}):
        await lock_user(session, user_id)


async def sweep_orphans(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore, *, stray_after: timedelta
) -> int:
    """Delete every bucket object no row will ever name again.

    Account deletion removes the row first and wipes the bucket best-effort
    afterwards; this sweep is what makes the wipe certain. A user row exists
    before any key is issued under its id, a recording or notation page row
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
    users, recordings, pages = _owned_prefixes([obj.key for obj in objects])
    if not users:
        return 0
    async with sessionmaker() as session:
        live = set(await session.scalars(select(User.id).where(User.id == _any_uuid(users))))
        candidates = {pair: prefix for pair, prefix in recordings.items() if pair[0] in live}
        page_candidates = {pair: prefix for pair, prefix in pages.items() if pair[0] in live}
        known: set[tuple[uuid.UUID, uuid.UUID]] = set()
        known_pages: set[tuple[uuid.UUID, uuid.UUID]] = set()
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
        if page_candidates:
            page_rows = await session.execute(
                select(NotationPage.user_id, NotationPage.id).where(
                    NotationPage.id == _any_uuid(page_id for _, page_id in page_candidates)
                )
            )
            known_pages.update(page_rows.tuples())
    orphans = [prefix for user_id, prefix in users.items() if user_id not in live]
    orphans += [prefix for pair, prefix in candidates.items() if pair not in known]
    orphans += [prefix for pair, prefix in page_candidates.items() if pair not in known_pages]
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
        int: How many recording and notation page slots were released.
    """
    released = await _release_recording_slots(sessionmaker, store)
    return released + await _release_page_slots(sessionmaker, store)


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


async def _release_page_slots(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    """Delete the image an abandoned page slot may have left, and the slot.

    A page's upload key is also the key it is served from, so unlike a recording's
    upload the object cannot be deleted before the re-check: a slot reissued and
    confirmed in between would lose its image. The re-check, the delete, and the
    slot removal all happen under the users' locks, which every reissue and
    confirmation also takes, and a failed delete rolls the slot removal back.
    """
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    stmt = (
        select(NotationPage)
        .join(UploadSlot, UploadSlot.notation_page_id == NotationPage.id)
        .where(UploadSlot.expires_at < cutoff, live_pending_page_slot())
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
                    select(UploadSlot.notation_page_id).where(
                        UploadSlot.notation_page_id.in_([page.id for page in rows]),
                        UploadSlot.expires_at < cutoff,
                    )
                )
            )
            if abandoned:
                await store.delete(
                    *(notation_key(page.user_id, page.id) for page in rows if page.id in abandoned)
                )
                await session.execute(
                    delete(UploadSlot).where(UploadSlot.notation_page_id.in_(abandoned))
                )
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


async def purge_deleted_pages(
    sessionmaker: async_sessionmaker[AsyncSession], store: ObjectStore
) -> int:
    """Remove the images of soft-deleted notation pages and leave their rows ready to upload again.

    A page tombstoned while its upload was being confirmed can still turn ready
    afterwards; its state alone makes the next sweep pick it up. A page's slot is kept
    until it passes ABANDONED_SLOT_GRACE, as in purge_deleted, so an image PUT after
    the first purge is collected by a later one.

    The rows are re-read under the users' locks and only then is any image deleted,
    so a page a client un-deleted and uploaded again meanwhile keeps its image.

    Returns:
        int: How many pages were swept.
    """
    cutoff = utc_now() - ABANDONED_SLOT_GRACE
    abandoned_slot = exists().where(
        UploadSlot.notation_page_id == NotationPage.id, UploadSlot.expires_at < cutoff
    )
    purgeable = (
        NotationPage.deleted_at.is_not(None),
        or_(
            NotationPage.file_key.is_not(None),
            NotationPage.state != NotationPageState.PENDING_UPLOAD.value,
            abandoned_slot,
        ),
    )
    async with sessionmaker() as session:
        async with session.begin():
            candidates = list(
                await session.scalars(select(NotationPage).where(*purgeable).limit(PURGE_BATCH))
            )
        if not candidates:
            return 0
        async with session.begin():
            await _lock_users(session, candidates)
            rows = list(
                await session.scalars(
                    select(NotationPage)
                    .where(NotationPage.id.in_([page.id for page in candidates]), *purgeable)
                    .execution_options(populate_existing=True)
                )
            )
            if not rows:
                return 0
            # A failed delete rolls the row changes back, so the next sweep retries both.
            await asyncio.gather(
                *(store.delete_prefix(notation_prefix(page.user_id, page.id)) for page in rows)
            )
            await session.execute(
                delete(UploadSlot).where(
                    UploadSlot.notation_page_id.in_([page.id for page in rows]),
                    UploadSlot.expires_at < cutoff,
                )
            )
            for page in rows:
                page.file_key = None
                page.file_bytes = None
                page.state = NotationPageState.PENDING_UPLOAD.value
                bump_page_server_seq(page)
        return len(rows)
