"""Declarative base and the sync-columns mixin every catalog table carries."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, DateTime, Sequence
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from uuid_utils import uuid7

# One global sequence across every synced table. Clients pull rows with a
# server_seq above the last one they saw, so the ordering must be total.
sync_seq = Sequence("sync_seq", start=1)


def next_server_seq():  # noqa: ANN201 -- a SQL expression, typed by SQLAlchemy at the call site
    """The expression that takes the next server_seq for a row the server changes."""
    return sync_seq.next_value()


def utc_now() -> datetime:
    """Timezone-aware timestamp for row creation and update columns."""
    return datetime.now(UTC)


def new_uuid7() -> uuid.UUID:
    """Time-ordered id for rows the server generates, keyed to insertion order."""
    return uuid.UUID(bytes=uuid7().bytes)


class Base(DeclarativeBase):
    """Declarative base."""


class SyncColumns:
    """Bookkeeping columns for last-write-wins sync and cursor pulls."""

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # Indexed per table alongside that table's owner column, which is how pull reads it.
    server_seq: Mapped[int] = mapped_column(
        BigInteger, sync_seq, server_default=sync_seq.next_value(), nullable=False
    )


def bump_server_seq(row: SyncColumns) -> None:
    """Take a new server_seq so every device pulls the change. updated_at stays the client's."""
    row.server_seq = next_server_seq()
