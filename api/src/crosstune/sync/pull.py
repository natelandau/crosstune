"""Cursor pull across every synced table."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from crosstune.models import List, ListItem
from crosstune.schemas.common import PULL_ROWS, PullRow
from crosstune.sync.tables import TABLES, row_to_dict

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession


async def pull_since(
    session: AsyncSession, user_id: uuid.UUID, since: int, limit: int
) -> tuple[list[PullRow], int, bool]:
    """Rows with server_seq above `since`, oldest first, at most `limit`.

    Each table contributes up to limit + 1 rows so has_more is exact after the merge.
    """
    candidates: list[tuple[int, PullRow]] = []
    for spec in TABLES.values():
        # spec.model and the row types vary by table at runtime, so neither the model's
        # columns nor the row fields are statically known here.
        model: Any = spec.model
        row_schema: Any = spec.row_schema
        pull_row: Any = PULL_ROWS[spec.name]
        stmt = select(model).where(model.server_seq > since)
        if spec.owner_column:
            stmt = stmt.where(getattr(model, spec.owner_column) == user_id)
        else:
            # list_items carry no owner; scope through the owning list.
            owned_lists = select(List.id).where(List.user_id == user_id)
            stmt = stmt.where(ListItem.list_id.in_(owned_lists))
        stmt = stmt.order_by(model.server_seq).limit(limit + 1)
        result = await session.execute(stmt)
        candidates.extend(
            (
                row.server_seq,
                pull_row(table=spec.name, row=row_schema.model_validate(row_to_dict(row))),
            )
            for row in result.scalars()
        )

    candidates.sort(key=lambda pair: pair[0])
    page = candidates[:limit]
    has_more = len(candidates) > limit
    next_since = page[-1][0] if page else since
    return [row for _, row in page], next_since, has_more
