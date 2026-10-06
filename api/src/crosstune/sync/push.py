"""Apply a batch of client changes with per-row last-write-wins."""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import TYPE_CHECKING, Any, cast

import asyncpg
from pydantic import ValidationError
from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import DBAPIError, IntegrityError

from crosstune.db.base import next_server_seq
from crosstune.db.locks import lock_user
from crosstune.db.session import request_runner_wake
from crosstune.models import List, ListItem
from crosstune.schemas.common import CHANGE_RESULTS, Change, ChangeResult
from crosstune.sync.rules import RULES, RowRules
from crosstune.sync.tables import TABLE_ORDER, TABLES, SyncedRow, TableSpec, row_to_dict

if TYPE_CHECKING:
    from collections.abc import Iterable, Mapping
    from datetime import datetime

    from pydantic import BaseModel
    from sqlalchemy import Select
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.links.resolve import ResolvedLink
    from crosstune.vocabulary import TableName


async def apply_push(
    session: AsyncSession,
    user_id: uuid.UUID,
    changes: list[Change],
    resolved_links: Mapping[str, ResolvedLink] | None = None,
) -> list[ChangeResult]:
    """Apply changes grouped by table in dependency order. Returns results in the input order.

    Args:
        session: The request's session; the caller commits.
        user_id: The pushing user.
        changes: The batch, in client order.
        resolved_links: What each untitled link URL resolved to before the transaction, or
            None to store untitled links as pushed. A URL missing from it is stored in its
            offline form.
    """
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
        entries = grouped.get(table, [])
        # Held for the group: the identity map keeps rows only while something refers to them.
        _held = await _prefetch(session, spec, [change for _, change in entries])
        if RULES.get(table, RowRules).defers_overlaps:
            await _apply_deferring_overlaps(session, spec, user_id, entries, results)
            continue
        for index, change in entries:
            if spec.append_only:
                results[index] = await _insert(session, spec, user_id, change)
            elif change.op == "upsert":
                results[index] = await _upsert(session, spec, user_id, change, resolved_links)
            else:
                results[index] = await _delete(session, spec, user_id, change)
    return [results[i] for i in range(len(changes))]


async def _prefetch(session: AsyncSession, spec: TableSpec, changes: list[Change]) -> list[object]:
    """Load the group's stored rows and the parents its changes name, one query per table.

    The ownership checks and table rules read rows one id at a time through `session.get`,
    which the identity map then answers without a round trip each. Earlier groups have
    already written, so a parent this push created or changed loads as it now stands.
    """
    wanted: dict[TableName, set[uuid.UUID]] = defaultdict(set)
    if not changes:
        return []
    wanted[spec.name].update(change.id for change in changes)
    for change in changes:
        for column, parent_table in spec.parents:
            parent_id = _as_uuid((change.data or {}).get(column))
            if parent_id is not None:
                wanted[parent_table].add(parent_id)
    loaded: list[object] = []
    for table, ids in wanted.items():
        model: Any = TABLES[table].model
        loaded.extend(await session.scalars(select(model).where(model.id.in_(ids))))
    return loaded


def _as_uuid(value: object) -> uuid.UUID | None:
    """The value as a UUID, or None when it is not one; validation reports it later."""
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value)) if value is not None else None
    except ValueError:
        return None


async def _apply_deferring_overlaps(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    entries: list[tuple[int, Change]],
    results: dict[int, ChangeResult],
) -> None:
    """Apply a batch's changes so a row never loses room another change in it frees.

    An outbox entry keeps its first position when its row is written again, so a loop can
    arrive ahead of the delete or the shrink that made room for it. Deletes go first, then
    each upsert that still overlaps a live row waits while the others land; once a pass
    makes no progress, the rest are applied and cut to their free stretch.
    """
    for index, change in entries:
        if change.op != "upsert":
            results[index] = await _delete(session, spec, user_id, change)
    pending = [(index, change) for index, change in entries if change.op == "upsert"]
    while pending:
        waiting: list[tuple[int, Change]] = []
        for index, change in pending:
            if await _overlaps(session, spec, user_id, change):
                waiting.append((index, change))
            else:
                results[index] = await _upsert(session, spec, user_id, change, None)
        if len(waiting) == len(pending):
            for index, change in waiting:
                results[index] = await _upsert(session, spec, user_id, change, None)
            return
        pending = waiting


async def _overlaps(
    session: AsyncSession, spec: TableSpec, user_id: uuid.UUID, change: Change
) -> bool:
    """Whether a pushed row's own rules say it overlaps a live row, judged before any clamp."""
    data, rejection = _validated(spec.data_schema, change)
    if rejection:
        return False
    return await _rules(session, spec.name, user_id, change, None).overlaps(data)


def _rules(
    session: AsyncSession,
    table: TableName,
    user_id: uuid.UUID,
    change: Change,
    resolved_links: Mapping[str, ResolvedLink] | None,
) -> RowRules:
    return RULES.get(table, RowRules)(session, user_id, change, resolved_links)


def _invalid(change: Change, reason: str) -> ChangeResult:
    result: Any = CHANGE_RESULTS[change.table]
    return result(table=change.table, id=change.id, status="invalid", reason=reason)


def _result(spec: TableSpec, change: Change, status: str, current: SyncedRow) -> ChangeResult:
    # The result and row types vary by table at runtime, so their fields aren't statically known.
    row_schema: Any = spec.row_schema
    result: Any = CHANGE_RESULTS[change.table]
    return result(
        table=change.table,
        id=change.id,
        status=status,
        row=row_schema.model_validate(row_to_dict(current)),
    )


async def _fetch_owned(
    session: AsyncSession, spec: TableSpec, row_id: uuid.UUID, user_id: uuid.UUID
) -> SyncedRow | None:
    """The row with this id if the caller owns it, else None."""
    # spec.model varies by table at runtime; every synced model carries the SyncedRow columns.
    row = cast("SyncedRow | None", await session.get(spec.model, row_id))
    if row is None:
        return None
    if spec.owner_column is not None:
        return row if getattr(row, spec.owner_column) == user_id else None
    # list_items: owned when its list is owned.
    parent = await session.get(List, cast("ListItem", row).list_id)
    return row if parent is not None and parent.user_id == user_id else None


async def _parents_owned(
    session: AsyncSession, spec: TableSpec, data: dict[str, Any], user_id: uuid.UUID
) -> str | None:
    """Return a reason string when a referenced parent is missing or not the caller's.

    A deleted parent still counts as owned for a table that accepts one: a loop is stored
    deleted instead, so a device that made it before learning of the delete gets a
    tombstone back, and an event is history a device can push after an offline delete.
    """
    deleted_ok = spec.accepts_deleted_parents
    for column, parent_table in spec.parents:
        if data.get(column) is None:
            # An unfiled recording has no tune yet; nothing to own.
            continue
        parent = await _fetch_owned(session, TABLES[parent_table], data[column], user_id)
        if parent is None or (parent.deleted_at is not None and not deleted_ok):
            return f"{column} does not reference one of your {parent_table}"
    return None


def _validated(
    data_schema: type[BaseModel], change: Change
) -> tuple[dict[str, Any], ChangeResult | None]:
    try:
        return data_schema.model_validate(change.data or {}).model_dump(), None
    except ValidationError as exc:
        fields = ", ".join(".".join(str(p) for p in e["loc"]) or "body" for e in exc.errors())
        return {}, _invalid(change, f"invalid fields: {fields}")


async def _checked(
    session: AsyncSession, spec: TableSpec, user_id: uuid.UUID, change: Change
) -> tuple[dict[str, Any], ChangeResult | None]:
    """The change's validated fields, or a rejection when they or their parents fail."""
    data, rejection = _validated(spec.data_schema, change)
    if rejection:
        return data, rejection
    reason = await _parents_owned(session, spec, data, user_id)
    if reason:
        return data, _invalid(change, reason)
    return data, None


def _owner(spec: TableSpec, user_id: uuid.UUID) -> dict[str, uuid.UUID]:
    return {spec.owner_column: user_id} if spec.owner_column is not None else {}


async def _write(
    session: AsyncSession, change: Change, stmt: Any, **execution_options: Any
) -> tuple[SyncedRow | None, ChangeResult | None]:
    """Run a write in a savepoint: the row it returned, or a rejection on a constraint or bad data.

    A value the database refuses comes back invalid rather than failing the push, since the
    client resends a failed push unchanged and would never get past it.
    """
    try:
        async with session.begin_nested():
            written = (
                await session.execute(stmt, execution_options=execution_options)
            ).scalar_one_or_none()
    except IntegrityError as exc:
        return None, _invalid(change, f"constraint violation: {exc.orig.__class__.__name__}")
    except DBAPIError as exc:
        refused = _refused_data(exc)
        if refused is None:
            raise
        return None, _invalid(change, f"invalid data: {refused.__class__.__name__}")
    return written, None


def _refused_data(exc: DBAPIError) -> BaseException | None:
    """The driver error behind `exc` when the database or driver refused a value, else None.

    The asyncpg dialect wraps both a server data exception (SQLSTATE class 22) and a value
    the driver cannot encode, such as an int outside int32, in a generic DBAPIError.
    """
    cause = exc.orig.__cause__ if exc.orig is not None else None
    # The driver's own encode error is a ValueError; asyncpg.DataError is the server's.
    if isinstance(cause, (asyncpg.exceptions.DataError, ValueError)):
        return cause
    return None


async def _upsert(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    change: Change,
    resolved_links: Mapping[str, ResolvedLink] | None,
) -> ChangeResult:
    data, rejection = await _checked(session, spec, user_id, change)
    if rejection:
        return rejection
    rules = _rules(session, spec.name, user_id, change, resolved_links)
    reason = await rules.prepare(data)
    if reason:
        return _invalid(change, reason)

    values = {
        "deleted_at": None,
        **data,
        "id": change.id,
        "updated_at": change.updated_at,
        **_owner(spec, user_id),
    }

    model: Any = spec.model
    stmt = insert(model).values(**values, server_seq=next_server_seq())
    excluded = stmt.excluded
    set_ = {
        k: getattr(excluded, k)
        for k in values
        if k not in ("id", "created_at") and k not in spec.insert_only
    }
    # The value the insert already drew, so an update spends one sequence value, not two.
    set_["server_seq"] = excluded.server_seq
    # Strictly newer wins, and only over a stored row the caller owns: for list_items that
    # is the stored row's list, since _parents_owned only checked the incoming parents.
    # Equal timestamps fall through to the no-op branch below.
    condition = (model.updated_at < excluded.updated_at) & spec.owned_by(user_id)
    stmt = stmt.on_conflict_do_update(
        index_elements=[model.id], set_=set_, where=condition
    ).returning(model)

    # populate_existing, so a copy of the row already in the session takes the write.
    written, rejection = await _write(session, change, stmt, populate_existing=True)
    if rejection:
        return rejection

    if written is not None:
        await rules.written(written)

    resolved = await _current_and_status(session, spec, user_id, change, written)
    if resolved is None:
        return _invalid(change, "id is not yours")
    current, status = resolved

    if status == "applied":
        await rules.applied(current)

    return _result(spec, change, status, current)


async def _insert(
    session: AsyncSession, spec: TableSpec, user_id: uuid.UUID, change: Change
) -> ChangeResult:
    """Store an event row once; a replay of a stored id is applied and changes nothing."""
    if change.op != "upsert":
        return _invalid(change, f"{spec.name} are insert-only")
    data, rejection = await _checked(session, spec, user_id, change)
    if rejection:
        return rejection

    model: Any = spec.model
    stmt = (
        insert(model)
        .values(**data, **_owner(spec, user_id), id=change.id, server_seq=next_server_seq())
        .on_conflict_do_nothing(index_elements=[model.id])
        .returning(model)
    )
    written, rejection = await _write(session, change, stmt)
    if rejection:
        return rejection

    current = written or await _fetch_owned(session, spec, change.id, user_id)
    if current is None:
        return _invalid(change, "id is not yours")
    return _result(spec, change, "applied", current)


async def _current_and_status(
    session: AsyncSession,
    spec: TableSpec,
    user_id: uuid.UUID,
    change: Change,
    written: SyncedRow | None,
) -> tuple[SyncedRow, str] | None:
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
    if current.deleted_at is not None:
        return _result(spec, change, "applied", current)
    if current.updated_at > change.updated_at:
        return _result(spec, change, "stale", current)

    model: Any = spec.model
    # populate_existing, so the copy of the row already in the session takes the write.
    current = (
        await session.execute(
            update(model)
            .where(model.id == change.id)
            .values(
                deleted_at=change.updated_at,
                updated_at=change.updated_at,
                server_seq=next_server_seq(),
            )
            .returning(model),
            execution_options={"populate_existing": True},
        )
    ).scalar_one()
    await _cascade(session, spec, [change.id], change.updated_at, user_id)
    if _reaches_files(spec):
        # A deleted row that owns files, or one the cascade reached, has files only the
        # runner's purge removes, and a purge has no due time to wake it.
        request_runner_wake(session)
    return _result(spec, change, "applied", current)


async def _cascade(
    session: AsyncSession,
    spec: TableSpec,
    parent_ids: Iterable[uuid.UUID] | Select[tuple[uuid.UUID]],
    at: datetime,
    user_id: uuid.UUID,
) -> None:
    """A parent delete is authoritative: dependents are soft-deleted regardless of their own timestamps.

    Grandchildren are marked before their parents, depth first in `children` order.
    Every statement carries the caller's ownership, so no cascade can reach another
    account's rows even if a parent row ever slipped past the ownership checks above.
    """
    for child_name, fk_column in spec.children:
        child = TABLES[child_name]
        model: Any = child.model
        child_ids = select(model.id).where(
            getattr(model, fk_column).in_(parent_ids), child.owned_by(user_id)
        )
        await _cascade(session, child, child_ids, at, user_id)
        await session.execute(
            update(model)
            .where(model.id.in_(child_ids), model.deleted_at.is_(None))
            .values(deleted_at=at, updated_at=at, server_seq=next_server_seq())
        )


def _reaches_files(spec: TableSpec) -> bool:
    """Whether deleting a row of this table can delete a row that owns bucket files."""
    return spec.owns_files or any(_reaches_files(TABLES[child]) for child, _ in spec.children)
