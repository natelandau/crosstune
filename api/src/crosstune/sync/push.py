"""Apply a batch of client changes with per-row last-write-wins."""

from __future__ import annotations

from collections import defaultdict
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import IntegrityError

from crosstune.db.base import next_server_seq
from crosstune.db.locks import lock_user
from crosstune.links.detect import detect_provider, normalize_url
from crosstune.models import List, ListItem, Recording, RecordingLink, Tune, UserTune
from crosstune.schemas.common import CHANGE_RESULTS, Change, ChangeResult, TableName
from crosstune.schemas.rows import TuneData, Tunings
from crosstune.sync.tables import TABLE_ORDER, TABLES, TableSpec, row_to_dict

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
    """Return a reason string when a referenced parent is missing or not the caller's."""
    for column, parent_table in spec.parents:
        if data.get(column) is None:
            # An unfiled recording has no tune yet; nothing to own.
            continue
        parent = await _fetch_owned(session, TABLES[parent_table], data[column], user_id)
        if parent is None or parent.deleted_at is not None:
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


# Legacy tune fields and the instrument each one names. Removed once every client sends tunings.
LEGACY_TUNINGS = {"violin_tuning": "violin", "banjo_tuning": "five_string_banjo"}


async def _fold_legacy_tunings(
    session: AsyncSession,
    user_id: uuid.UUID,
    tune_id: uuid.UUID,
    validated: TuneData,
    data: dict[str, Any],
) -> dict[str, Any]:
    """Write legacy tuning fields into the tunings map, keeping every other entry and capo."""
    sent = [field for field in LEGACY_TUNINGS if field in validated.model_fields_set]
    for field in LEGACY_TUNINGS:
        data.pop(field, None)
    if not sent:
        return data
    if "tunings" in validated.model_fields_set:
        base: dict[str, Any] = data["tunings"]
    else:
        # A client with no tunings of its own edits only its two instruments.
        stored = await session.scalar(
            select(Tune.tunings).where(Tune.id == tune_id, Tune.owner_user_id == user_id)
        )
        base = stored or {}
    merged = {name: dict(entry) for name, entry in base.items()}
    for field in sent:
        instrument = LEGACY_TUNINGS[field]
        merged.setdefault(instrument, {})["tuning"] = getattr(validated, field)
    data["tunings"] = Tunings.model_validate(merged).model_dump()
    return data


async def _upsert(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    change: Change,
    enrich_link: Callable[[str], Awaitable[Resolved]] | None,
) -> ChangeResult:
    data_schema: Any = spec.data_schema
    try:
        validated = data_schema.model_validate(change.data or {})
    except ValidationError as exc:
        fields = ", ".join(".".join(str(p) for p in e["loc"]) or "body" for e in exc.errors())
        return _invalid(change, f"invalid fields: {fields}")
    data = validated.model_dump()
    if spec.name == "tunes":
        data = await _fold_legacy_tunings(session, user_id, change.id, validated, data)

    reason = await _parents_owned(session, spec, data, user_id)
    if reason:
        return _invalid(change, reason)

    if spec.name == "recording_links":
        await _enrich_recording_link(data, enrich_link)

    values = {**data, "id": change.id, "updated_at": change.updated_at, "deleted_at": None}
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

    # A row the write skipped is either newer or someone else's, and only a read tells which.
    current = written
    if current is None:
        current = await _fetch_owned(session, spec, change.id, user_id)
        if current is None:
            return _invalid(change, "id is not yours")
        await session.refresh(current)
    row_schema: Any = spec.row_schema
    result: Any = CHANGE_RESULTS[change.table]
    status = (
        "applied" if written is not None or current.updated_at == change.updated_at else "stale"
    )
    return result(
        table=change.table,
        id=change.id,
        status=status,
        row=row_schema.model_validate(row_to_dict(current)),
    )


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
        await mark(Recording, (Recording.tune_id == row_id) & (Recording.user_id == user_id))
    elif table == "user_tunes":
        await mark(ListItem, (ListItem.user_tune_id == row_id) & owned_items)
    elif table == "lists":
        await mark(ListItem, (ListItem.list_id == row_id) & owned_items)
