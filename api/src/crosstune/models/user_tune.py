"""One player's relationship to one tune."""

from __future__ import annotations

import uuid
from datetime import (
    date,
    datetime,
)

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list
from crosstune.vocabulary import LIMITS, TuneStatus


class UserTune(SyncColumns, Base):
    """Status, provenance, and notes. Musical facets live on Tune."""

    __tablename__ = "user_tunes"
    __table_args__ = (
        UniqueConstraint("user_id", "tune_id", name="uq_user_tunes_user_tune"),
        CheckConstraint(
            in_list("status", tuple(TuneStatus), nullable=False), name="ck_user_tunes_status"
        ),
        Index("ix_user_tunes_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tune_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tunes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False)
    learned_from: Mapped[str | None] = mapped_column(
        String(LIMITS["user_tunes"]["learned_from"]), nullable=True
    )
    learned_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
