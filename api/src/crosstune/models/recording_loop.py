"""A labeled practice range on a recording's source timeline."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, SmallInteger, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import between
from crosstune.vocabulary import LIMITS, LOOP_COLOR_COUNT, MIN_LOOP_MS


class RecordingLoop(SyncColumns, Base):
    """Positions are source-timeline milliseconds, so a loop survives a trim of its recording."""

    __tablename__ = "recording_loops"
    __table_args__ = (
        CheckConstraint("start_ms >= 0", name="ck_recording_loops_start_ms"),
        CheckConstraint(
            f"deleted_at IS NOT NULL OR end_ms - start_ms >= {MIN_LOOP_MS}",
            name="ck_recording_loops_min_length",
        ),
        CheckConstraint(between("color", 0, LOOP_COLOR_COUNT - 1), name="ck_recording_loops_color"),
        Index("ix_recording_loops_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    label: Mapped[str | None] = mapped_column(
        String(LIMITS["recording_loops"]["label"]), nullable=True
    )
    start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    end_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    color: Mapped[int] = mapped_column(SmallInteger, nullable=False)
