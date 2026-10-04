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
    SmallInteger,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import between, in_list
from crosstune.vocabulary import (
    LIMITS,
    PITCH_CENTS_MAX,
    PITCH_CENTS_MIN,
    SPEED_PERCENT_MAX,
    SPEED_PERCENT_MIN,
    RecordingOrigin,
    RecordingPrecision,
    RecordingSource,
    RecordingState,
)


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
            in_list("origin", tuple(RecordingOrigin), nullable=False), name="ck_recordings_origin"
        ),
        CheckConstraint("(origin = 'own') = (origin_url is null)", name="ck_recordings_origin_url"),
        CheckConstraint(
            "(source = 'import') = (origin <> 'own')", name="ck_recordings_import_origin"
        ),
        CheckConstraint(
            in_list("recorded_precision", tuple(RecordingPrecision), nullable=True),
            name="ck_recordings_recorded_precision",
        ),
        CheckConstraint(
            "(recorded_at is null) = (recorded_precision is null)",
            name="ck_recordings_recorded_date",
        ),
        CheckConstraint(
            in_list("state", tuple(RecordingState), nullable=False), name="ck_recordings_state"
        ),
        CheckConstraint("trim_start_ms >= 0", name="ck_recordings_trim_start_ms"),
        CheckConstraint(
            between("speed_percent", SPEED_PERCENT_MIN, SPEED_PERCENT_MAX),
            name="ck_recordings_speed_percent",
        ),
        CheckConstraint(
            between("pitch_cents", PITCH_CENTS_MIN, PITCH_CENTS_MAX),
            name="ck_recordings_pitch_cents",
        ),
        Index("ix_recordings_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Null while the recording is unfiled; the save sheet attaches it later, and a
    # hard delete of the tune unfiles the recording rather than destroying the audio.
    tune_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tunes.id", ondelete="SET NULL"), nullable=True, index=True
    )
    label: Mapped[str | None] = mapped_column(String(LIMITS["recordings"]["label"]), nullable=True)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    # Client-owned provenance: "own" for the user's recordings, else the import source and
    # the page it came from. Only an import has a source of "import".
    origin: Mapped[str] = mapped_column(
        String(20), nullable=False, default=RecordingOrigin.OWN.value, server_default="own"
    )
    origin_url: Mapped[str | None] = mapped_column(
        String(LIMITS["recordings"]["origin_url"]), nullable=True
    )
    added_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # When the music was played, if known. A partial date is stored as UTC midnight at the
    # start of its year, month, or day.
    recorded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recorded_precision: Mapped[str | None] = mapped_column(String(10), nullable=True)
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

    # Client-owned trim and playback settings. trim_end_ms of null means the source end,
    # and a trim only narrows an existing range, never widens it.
    trim_start_ms: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    trim_end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    speed_percent: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=100, server_default="100"
    )
    pitch_cents: Mapped[int] = mapped_column(
        SmallInteger, nullable=False, default=0, server_default="0"
    )

    # Server-owned playback file bookkeeping, rebuilt whenever a trim changes.
    source_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    playback_start_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    playback_end_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    playback_rev: Mapped[str | None] = mapped_column(String(8), nullable=True)
    peaks_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    peaks_rev: Mapped[str | None] = mapped_column(String(8), nullable=True)
    peaks_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
