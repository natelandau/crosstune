"""Declarative base and the sync-columns mixin every catalog table carries."""

from __future__ import annotations

from datetime import datetime  # noqa: TC003 -- SQLAlchemy evaluates Mapped[] annotations at runtime

from sqlalchemy import BigInteger, DateTime, Sequence
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

# One global sequence across every synced table. Clients pull rows with a
# server_seq above the last one they saw, so the ordering must be total.
sync_seq = Sequence("sync_seq", start=1)


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
