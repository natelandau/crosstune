"""Cursor pull across every synced table."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from crosstune.db.locks import share_user_lock
from crosstune.models import StatusChange
from crosstune.schemas.common import (
    PULL_ROWS,
    EventRow,
    PlayEventPullRow,
    PracticeSessionPullRow,
    PullRow,
    ScanViewPullRow,
    StatusChangePullRow,
)
from crosstune.schemas.rows import (
    PlayEventRow,
    PracticeSessionRow,
    ScanViewRow,
    StatusChangeRow,
)
from crosstune.sync.tables import TABLES, row_to_dict

if TYPE_CHECKING:
    import uuid

    from pydantic import BaseModel
    from sqlalchemy import ColumnElement
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.sync.tables import TableSpec

EVENT_ROWS: dict[str, tuple[type[BaseModel], type[BaseModel]]] = {
    "play_events": (PlayEventPullRow, PlayEventRow),
    "practice_sessions": (PracticeSessionPullRow, PracticeSessionRow),
    "scan_views": (ScanViewPullRow, ScanViewRow),
    "status_changes": (StatusChangePullRow, StatusChangeRow),
}
"""Each history table's pull row and the row schema it wraps."""


async def pull_since(
    session: AsyncSession, user_id: uuid.UUID, since: int, limit: int
) -> tuple[list[PullRow], int, bool]:
    """Rows with server_seq above `since`, oldest first, at most `limit`.

    Each table contributes up to limit + 1 rows so has_more is exact after the merge. Only
    the rows that make the page are validated.
    """
    sources = [
        (spec.model, spec.owned_by(user_id), spec) for spec in TABLES.values() if spec.pulled
    ]
    await share_user_lock(session, user_id)
    page, next_since, has_more = await _merged_page(session, sources, since, limit)
    return [_pull_row(spec, row) for spec, row in page], next_since, has_more


async def events_since(
    session: AsyncSession, user_id: uuid.UUID, since: int, limit: int
) -> tuple[list[EventRow], int, bool]:
    """History rows with server_seq above `since`, oldest first, at most `limit`.

    Plays, practice sessions, scan views and status changes live outside the main pull, so
    they page on a cursor of their own with the same merge as `pull_since`.
    """
    sources: list[tuple[Any, ColumnElement[bool], str]] = [
        (StatusChange, StatusChange.user_id == user_id, "status_changes")
    ]
    sources.extend(
        (spec.model, spec.owned_by(user_id), spec.name)
        for spec in TABLES.values()
        if spec.append_only
    )
    await share_user_lock(session, user_id)
    page, next_since, has_more = await _merged_page(session, sources, since, limit)
    return [_event_row(name, row) for name, row in page], next_since, has_more


async def _merged_page[T](
    session: AsyncSession,
    sources: list[tuple[Any, ColumnElement[bool], T]],
    since: int,
    limit: int,
) -> tuple[list[tuple[T, Any]], int, bool]:
    """Merge the oldest rows above `since` from every source into one page.

    One probe first finds the sources with any row above `since`, so a poll with nothing
    new costs one round trip and a busy one reads only the tables that changed. The
    caller holds the user's shared lock, so no write commits between these statements:
    one landing after a table was read would hold a seq the cursor then skips past.
    """
    probe = select(
        *(
            select(model.id).where(model.server_seq > since, owned).exists()
            for model, owned, _ in sources
        )
    )
    changed = (await session.execute(probe)).one()
    candidates: list[tuple[int, T, Any]] = []
    for (model, owned, tag), has_rows in zip(sources, changed, strict=True):
        if not has_rows:
            continue
        stmt = (
            select(model)
            .where(model.server_seq > since, owned)
            .order_by(model.server_seq)
            .limit(limit + 1)
        )
        result = await session.execute(stmt)
        candidates.extend((row.server_seq, tag, row) for row in result.scalars())

    candidates.sort(key=lambda candidate: candidate[0])
    page = candidates[:limit]
    has_more = len(candidates) > limit
    next_since = page[-1][0] if page else since
    return [(tag, row) for _, tag, row in page], next_since, has_more


def _event_row(name: str, row: Any) -> EventRow:
    # The row types vary by table at runtime, so their fields aren't statically known here.
    pull_row, row_schema = EVENT_ROWS[name]
    event_row: Any = pull_row
    return event_row(table=name, row=row_schema.model_validate(row_to_dict(row)))


def _pull_row(spec: TableSpec, row: Any) -> PullRow:
    # The row types vary by table at runtime, so their fields aren't statically known here.
    row_schema: Any = spec.row_schema
    pull_row: Any = PULL_ROWS[spec.name]
    return pull_row(table=spec.name, row=row_schema.model_validate(row_to_dict(row)))
