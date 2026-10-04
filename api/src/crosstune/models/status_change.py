"""One change of a tune's status for a player, kept as history."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, sync_seq
from crosstune.models._checks import in_list
from crosstune.vocabulary import TuneStatus

STATUSES = tuple(TuneStatus)


class StatusChange(Base):
    """A null `from_status` marks the first status a user tune held."""

    __tablename__ = "status_changes"
    __table_args__ = (
        CheckConstraint(in_list("from_status", STATUSES), name="ck_status_changes_from_status"),
        CheckConstraint(
            in_list("to_status", STATUSES, nullable=False), name="ck_status_changes_to_status"
        ),
        Index("ix_status_changes_user_id_server_seq", "user_id", "server_seq"),
        Index("ix_status_changes_user_id_changed_at", "user_id", "changed_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_tune_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("user_tunes.id", ondelete="CASCADE"), nullable=False
    )
    from_status: Mapped[str | None] = mapped_column(String(20), nullable=True)
    to_status: Mapped[str] = mapped_column(String(20), nullable=False)
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    server_seq: Mapped[int] = mapped_column(
        BigInteger, sync_seq, server_default=sync_seq.next_value(), nullable=False
    )
