"""Cursor pull across every synced table."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from crosstune.schemas.common import PULL_ROWS, PullRow
from crosstune.sync.tables import TABLES, row_to_dict

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.sync.tables import TableSpec


async def pull_since(
    session: AsyncSession, user_id: uuid.UUID, since: int, limit: int
) -> tuple[list[PullRow], int, bool]:
    """Rows with server_seq above `since`, oldest first, at most `limit`.

    Each table contributes up to limit + 1 rows so has_more is exact after the merge. Only
    the rows that make the page are validated.
    """
    candidates: list[tuple[int, TableSpec, Any]] = []
    for spec in TABLES.values():
        # spec.model varies by table at runtime, so its columns aren't statically known here.
        model: Any = spec.model
        stmt = (
            select(model)
            .where(model.server_seq > since, spec.owned_by(user_id))
            .order_by(model.server_seq)
            .limit(limit + 1)
        )
        result = await session.execute(stmt)
        candidates.extend((row.server_seq, spec, row) for row in result.scalars())

    candidates.sort(key=lambda candidate: candidate[0])
    page = candidates[:limit]
    has_more = len(candidates) > limit
    next_since = page[-1][0] if page else since
    return [_pull_row(spec, row) for _, spec, row in page], next_since, has_more


def _pull_row(spec: TableSpec, row: Any) -> PullRow:
    # The row types vary by table at runtime, so their fields aren't statically known here.
    row_schema: Any = spec.row_schema
    pull_row: Any = PULL_ROWS[spec.name]
    return pull_row(table=spec.name, row=row_schema.model_validate(row_to_dict(row)))
