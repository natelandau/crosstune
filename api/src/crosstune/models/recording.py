"""A recording the user made or uploaded, stored as an object in R2."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list
from crosstune.vocabulary import LIMITS, RecordingSource, RecordingState


class Recording(SyncColumns, Base):
    """One audio file. The client owns the descriptive columns; the server owns the file columns.

    A push writes only the client's columns, so state and keys survive any client upsert.
    """

    __tablename__ = "recordings"
    __table_args__ = (
        CheckConstraint(
            in_list("source", tuple(RecordingSource), nullable=False), name="ck_recordings_source"
        ),
        CheckConstraint(
            in_list("state", tuple(RecordingState), nullable=False), name="ck_recordings_state"
        ),
        Index("ix_recordings_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Null while the recording is unfiled; the save sheet attaches it later, and a
    # hard delete of the song unfiles the recording rather than destroying the audio.
    song_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("songs.id", ondelete="SET NULL"), nullable=True, index=True
    )
    label: Mapped[str | None] = mapped_column(String(LIMITS["recordings"]["label"]), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RecordingState.PENDING_UPLOAD.value
    )
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    playback_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    playback_mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    playback_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    original_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    original_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
