"""Apply a batch of client changes with per-row last-write-wins."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import ValidationError
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from crosstune.db.base import next_server_seq
from crosstune.db.locks import lock_user
from crosstune.db.session import request_runner_wake
from crosstune.links.detect import detect_provider, normalize_url
from crosstune.models import (
    List,
    ListItem,
    Recording,
    RecordingLink,
    RecordingLoop,
    UserTune,
)
from crosstune.recordings.loops import clamp_loop, clamp_span, loop_bounds, reclamp_recording_loops
from crosstune.recordings.service import ensure_trim_job
from crosstune.recordings.trim import clamp_trim
from crosstune.schemas.common import CHANGE_RESULTS, Change, ChangeResult, TableName
from crosstune.sync.tables import TABLE_ORDER, TABLES, TableSpec, row_to_dict
from crosstune.vocabulary import MAX_LOOPS_PER_RECORDING

if TYPE_CHECKING:
    import uuid
    from collections.abc import Awaitable, Callable
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession


class Resolved(Protocol):
    """What a link enricher returns. Any object exposing these read-only attributes satisfies it."""

    @property
    def url(self) -> str:
        """The canonical URL for the link."""
        ...

    @property
    def provider(self) -> str:
        """The provider the URL points at."""
        ...

    @property
    def provider_ref(self) -> str | None:
        """The provider's own id for the recording, or None when there is none."""
        ...

    @property
    def title(self) -> str | None:
        """The resolved title, or None if resolution found none."""
        ...

    @property
    def artwork_url(self) -> str | None:
        """The resolved artwork URL, or None if resolution found none."""
        ...


async def apply_push(
    session: AsyncSession,
    user_id: uuid.UUID,
    changes: list[Change],
    enrich_link: Callable[[str], Awaitable[Resolved]] | None = None,
) -> list[ChangeResult]:
    """Apply changes grouped by table in dependency order. Returns results in the input order."""
    # Serializes this user's concurrent pushes so server_seq is assigned in commit order,
    # matching the order a pull cursor relies on. Released automatically when the request's
    # transaction ends.
    await lock_user(session, user_id)

    grouped: dict[TableName, list[tuple[int, Change]]] = defaultdict(list)
    for index, change in enumerate(changes):
        grouped[change.table].append((index, change))

    results: dict[int, ChangeResult] = {}
    for table in TABLE_ORDER:
        spec = TABLES[table]
        for index, change in grouped.get(table, []):
            if change.op == "upsert":
                results[index] = await _upsert(session, spec, user_id, change, enrich_link)
            else:
                results[index] = await _delete(session, spec, user_id, change)
    return [results[i] for i in range(len(changes))]


def _invalid(change: Change, reason: str) -> ChangeResult:
    result: Any = CHANGE_RESULTS[change.table]
    return result(table=change.table, id=change.id, status="invalid", reason=reason)


async def _fetch_owned(
    session: AsyncSession, spec: TableSpec, row_id: uuid.UUID, user_id: uuid.UUID
) -> Any | None:
    """The row with this id if the caller owns it, else None."""
    # spec.model varies by table at runtime, so its columns aren't statically known here.
    row: Any = await session.get(spec.model, row_id)
    if row is None:
        return None
    if spec.owner_column:
        return row if getattr(row, spec.owner_column) == user_id else None
    # list_items: owned when its list is owned.
    parent: Any = await session.get(TABLES["lists"].model, row.list_id)
    return row if parent is not None and parent.user_id == user_id else None


async def _parents_owned(
    session: AsyncSession, spec: TableSpec, data: dict[str, Any], user_id: uuid.UUID
) -> str | None:
    """Return a reason string when a referenced parent is missing or not the caller's.

    A loop's deleted recording still counts as owned: the loop is stored deleted instead,
    so a device that made it before learning of the delete gets a tombstone back.
    """
    for column, parent_table in spec.parents:
        if data.get(column) is None:
            # An unfiled recording has no tune yet; nothing to own.
            continue
        parent = await _fetch_owned(session, TABLES[parent_table], data[column], user_id)
        deleted_ok = spec.name == "recording_loops"
        if parent is None or (parent.deleted_at is not None and not deleted_ok):
            return f"{column} does not reference one of your {parent_table}"
    return None


async def _enrich_recording_link(
    data: dict[str, Any], enrich_link: Callable[[str], Awaitable[Resolved]] | None
) -> None:
    """Bring a pushed link to the shape the online paste path stores, in place.

    Args:
        data: The validated link fields; url, provider, provider_ref, title, and
            artwork_url may be rewritten.
        enrich_link: The resolver for an untitled link, or None when nothing was fetched.
    """
    if enrich_link is not None and data.get("title") is None:
        resolved = await enrich_link(data["url"])
        # Store what the online paste path would have stored: the canonical url and the
        # provider the resolver identified, not the raw string the client happened to hold.
        data["url"] = resolved.url
        data["provider"] = resolved.provider
        data["provider_ref"] = resolved.provider_ref or data.get("provider_ref")
        data["title"] = resolved.title
        data["artwork_url"] = data.get("artwork_url") or resolved.artwork_url

    if data["provider"] == "other":
        # A client that predates a provider saves its links as other, and a titled link is
        # never resolved, so detect it here, without a fetch.
        provider, ref = detect_provider(data["url"])
        if provider != "other":
            data["url"] = normalize_url(data["url"], provider, ref)
            data["provider"] = provider
            data["provider_ref"] = ref


async def _clamp_recording_trim(
    session: AsyncSession, recording_id: uuid.UUID, data: dict[str, Any]
) -> None:
    """Keep a pushed trim inside the stored row's playback range, in place.

    Reads the row already in the database rather than the pushed values, so a stale
    push (rejected by the upsert's timestamp check below) never has its rewritten
    trim mistaken for what was actually written.
    """
    stored: Recording | None = await session.get(Recording, recording_id)
    low = (stored.playback_start_ms or 0) if stored else 0
    high = stored.playback_end_ms if stored else None
    source_end = stored.source_duration_ms if stored else None
    end = data["trim_end_ms"]
    # A null end means the source end, which a playback file cut short no longer
    # reaches, so it is clamped as that end and only stays null where it still fits.
    if end is None and source_end is not None:
        end = source_end
    start, end = clamp_trim(data["trim_start_ms"], end, low=low, high=high)
    if data["trim_end_ms"] is None and end == source_end:
        end = None
    data["trim_start_ms"], data["trim_end_ms"] = start, end


async def _clamp_loop(session: AsyncSession, data: dict[str, Any]) -> bool:
    """Keep a pushed loop inside its recording's trim, in place.

    Returns:
        bool: False when too little of the loop remains or its recording is deleted, in
            which case `data` holds the clamped span and the loop must be stored deleted.
    """
    recording = await session.get(Recording, data["recording_id"])
    if recording is None:
        return True
    if recording.deleted_at is not None:
        return False
    low, high = loop_bounds(recording)
    fits = clamp_loop(data["start_ms"], data["end_ms"], low=low, high=high) is not None
    data["start_ms"], data["end_ms"] = clamp_span(
        data["start_ms"], data["end_ms"], low=low, high=high
    )
    return fits


async def _loop_cap_reached(
    session: AsyncSession, user_id: uuid.UUID, loop_id: uuid.UUID, recording_id: uuid.UUID
) -> bool:
    """Whether the recording already holds the most live loops, not counting this one."""
    live = await session.scalar(
        select(func.count())
        .select_from(RecordingLoop)
        .where(
            RecordingLoop.recording_id == recording_id,
            RecordingLoop.user_id == user_id,
            RecordingLoop.deleted_at.is_(None),
            RecordingLoop.id != loop_id,
        )
    )
    return (live or 0) >= MAX_LOOPS_PER_RECORDING


async def _prepare_loop(
    session: AsyncSession, user_id: uuid.UUID, change: Change, data: dict[str, Any]
) -> tuple[ChangeResult | None, datetime | None]:
    """Clamp a pushed loop and enforce the cap, returning a rejection or its `deleted_at`."""
    fits = await _clamp_loop(session, data)
    if (
        fits
        and not await _write_keeps_live_count(session, user_id, change, data["recording_id"])
        and await _loop_cap_reached(session, user_id, change.id, data["recording_id"])
    ):
        return _invalid(change, "loop limit reached"), None
    return None, None if fits else change.updated_at


async def _write_keeps_live_count(
    session: AsyncSession, user_id: uuid.UUID, change: Change, recording_id: uuid.UUID
) -> bool:
    """Whether this write cannot add a live loop to `recording_id`, so the cap does not apply.

    True when the stored loop's timestamp is not older than the change, so last-write-wins
    writes nothing, or when the stored loop is already live on that recording.
    """
    stored: RecordingLoop | None = await session.get(RecordingLoop, change.id)
    if stored is None or stored.user_id != user_id:
        return False
    if stored.updated_at >= change.updated_at:
        return True
    return stored.deleted_at is None and stored.recording_id == recording_id


async def _after_recording_write(session: AsyncSession, current: Recording, at: datetime) -> None:
    # Queued from the row as committed by the upsert, in the same transaction as the push.
    await ensure_trim_job(session, current)
    await reclamp_recording_loops(session, current, at)


async def _prepare(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    change: Change,
    data: dict[str, Any],
    enrich_link: Callable[[str], Awaitable[Resolved]] | None,
) -> tuple[ChangeResult | None, datetime | None]:
    """Apply a table's pre-write rules to `data`, returning a rejection or the row's `deleted_at`."""
    if spec.name == "recording_links":
        await _enrich_recording_link(data, enrich_link)
    elif spec.name == "recordings":
        await _clamp_recording_trim(session, change.id, data)
    elif spec.name == "recording_loops":
        return await _prepare_loop(session, user_id, change, data)
    return None, None


def _validated(data_schema: Any, change: Change) -> tuple[dict[str, Any], ChangeResult | None]:
    try:
        return data_schema.model_validate(change.data or {}).model_dump(), None
    except ValidationError as exc:
        fields = ", ".join(".".join(str(p) for p in e["loc"]) or "body" for e in exc.errors())
        return {}, _invalid(change, f"invalid fields: {fields}")


async def _upsert(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    change: Change,
    enrich_link: Callable[[str], Awaitable[Resolved]] | None,
) -> ChangeResult:
    data_schema: Any = spec.data_schema
    data, rejection = _validated(data_schema, change)
    if rejection:
        return rejection

    reason = await _parents_owned(session, spec, data, user_id)
    if reason:
        return _invalid(change, reason)

    rejection, deleted_at = await _prepare(session, spec, user_id, change, data, enrich_link)
    if rejection:
        return rejection

    values = {**data, "id": change.id, "updated_at": change.updated_at, "deleted_at": deleted_at}
    if spec.owner_column:
        values[spec.owner_column] = user_id

    model: Any = spec.model
    stmt = insert(model).values(**values, server_seq=next_server_seq())
    excluded = stmt.excluded
    set_ = {k: getattr(excluded, k) for k in values if k not in ("id", "created_at")}
    set_["server_seq"] = next_server_seq()
    # Strictly newer wins. Equal timestamps fall through to the no-op branch below.
    condition = model.updated_at < excluded.updated_at
    if spec.owner_column:
        condition = condition & (getattr(model, spec.owner_column) == user_id)
    else:
        # list_items has no owner column; require the *stored* row's list to be the
        # caller's, since _parents_owned only checked the incoming list_id/user_tune_id.
        condition = condition & model.list_id.in_(select(List.id).where(List.user_id == user_id))
    stmt = stmt.on_conflict_do_update(
        index_elements=[model.id], set_=set_, where=condition
    ).returning(model)

    try:
        async with session.begin_nested():
            # populate_existing, so a copy of the row already in the session takes the write.
            written = (
                await session.execute(stmt, execution_options={"populate_existing": True})
            ).scalar_one_or_none()
    except IntegrityError as exc:
        return _invalid(change, f"constraint violation: {exc.orig.__class__.__name__}")

    resolved = await _current_and_status(session, spec, user_id, change, written)
    if resolved is None:
        return _invalid(change, "id is not yours")
    current, status = resolved

    if spec.name == "recordings" and status == "applied":
        await _after_recording_write(session, current, change.updated_at)

    row_schema: Any = spec.row_schema
    result: Any = CHANGE_RESULTS[change.table]
    return result(
        table=change.table,
        id=change.id,
        status=status,
        row=row_schema.model_validate(row_to_dict(current)),
    )


async def _current_and_status(
    session: AsyncSession, spec: TableSpec, user_id: uuid.UUID, change: Change, written: Any
) -> tuple[Any, str] | None:
    """The row now in place and whether the change applied, or None when the id isn't the caller's.

    A row the write skipped is either newer or someone else's, and only a read tells which.
    """
    current = written
    if current is None:
        current = await _fetch_owned(session, spec, change.id, user_id)
        if current is None:
            return None
        await session.refresh(current)
    status = (
        "applied" if written is not None or current.updated_at == change.updated_at else "stale"
    )
    return current, status


async def _delete(
    session: AsyncSession, spec: TableSpec, user_id: uuid.UUID, change: Change
) -> ChangeResult:
    current = await _fetch_owned(session, spec, change.id, user_id)
    if current is None:
        return _invalid(change, "not found")
    row_schema: Any = spec.row_schema
    result: Any = CHANGE_RESULTS[change.table]
    if current.deleted_at is not None:
        return result(
            table=change.table,
            id=change.id,
            status="applied",
            row=row_schema.model_validate(row_to_dict(current)),
        )
    if current.updated_at > change.updated_at:
        return result(
            table=change.table,
            id=change.id,
            status="stale",
            row=row_schema.model_validate(row_to_dict(current)),
        )

    model: Any = spec.model
    await session.execute(
        update(model)
        .where(model.id == change.id)
        .values(
            deleted_at=change.updated_at, updated_at=change.updated_at, server_seq=next_server_seq()
        )
    )
    await _cascade(session, spec.name, change.id, change.updated_at, user_id)
    if spec.name in ("recordings", "tunes"):
        # A deleted recording, or one a tune delete cascades to, has files only the
        # runner's purge removes, and a purge has no due time to wake it.
        request_runner_wake(session)
    await session.refresh(current)
    return result(
        table=change.table,
        id=change.id,
        status="applied",
        row=row_schema.model_validate(row_to_dict(current)),
    )


async def _cascade(
    session: AsyncSession, table: TableName, row_id: uuid.UUID, at: datetime, user_id: uuid.UUID
) -> None:
    """A parent delete is authoritative: dependents are soft-deleted regardless of their own timestamps."""

    async def mark(model, where) -> None:  # noqa: ANN001
        await session.execute(
            update(model)
            .where(where, model.deleted_at.is_(None))
            .values(deleted_at=at, updated_at=at, server_seq=next_server_seq())
        )

    # Every statement carries the caller's ownership, so no cascade can reach another
    # account's rows even if a parent row ever slipped past the ownership checks above.
    owned_items = ListItem.list_id.in_(select(List.id).where(List.user_id == user_id))
    if table == "tunes":
        user_tune_ids = select(UserTune.id).where(
            UserTune.tune_id == row_id, UserTune.user_id == user_id
        )
        await mark(ListItem, ListItem.user_tune_id.in_(user_tune_ids) & owned_items)
        await mark(UserTune, (UserTune.tune_id == row_id) & (UserTune.user_id == user_id))
        await mark(
            RecordingLink,
            (RecordingLink.tune_id == row_id) & (RecordingLink.added_by_user_id == user_id),
        )
        tune_recording_ids = select(Recording.id).where(
            Recording.tune_id == row_id, Recording.user_id == user_id
        )
        await mark(
            RecordingLoop,
            RecordingLoop.recording_id.in_(tune_recording_ids) & (RecordingLoop.user_id == user_id),
        )
        await mark(Recording, (Recording.tune_id == row_id) & (Recording.user_id == user_id))
    elif table == "user_tunes":
        await mark(ListItem, (ListItem.user_tune_id == row_id) & owned_items)
    elif table == "lists":
        await mark(ListItem, (ListItem.list_id == row_id) & owned_items)
    elif table == "recordings":
        await mark(
            RecordingLoop,
            (RecordingLoop.recording_id == row_id) & (RecordingLoop.user_id == user_id),
        )
