"""A song with all of its musical facets."""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list

MODES: tuple[str, ...] = ("major", "minor", "mixolydian", "dorian", "other")
TIME_SIGNATURES: tuple[str, ...] = ("4/4", "2/4", "2/2", "3/4", "6/8", "9/8", "12/8", "other")


class Song(SyncColumns, Base):
    """One song. owner_user_id is null only for a future shared catalog entry."""

    __tablename__ = "songs"
    __table_args__ = (
        CheckConstraint(in_list("mode", MODES), name="ck_songs_mode"),
        CheckConstraint(in_list("time_signature", TIME_SIGNATURES), name="ck_songs_time_signature"),
        Index("ix_songs_owner_user_id_server_seq", "owner_user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True, index=True
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("songs.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    alternate_titles: Mapped[list[str]] = mapped_column(
        ARRAY(String(200)), nullable=False, default=list
    )
    genre: Mapped[str | None] = mapped_column(String(100), nullable=True)
    feel: Mapped[str | None] = mapped_column(String(100), nullable=True)
    lyrics: Mapped[str | None] = mapped_column(Text, nullable=True)
    key: Mapped[str | None] = mapped_column(String(10), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    violin_tuning: Mapped[str | None] = mapped_column(String(100), nullable=True)
    banjo_tuning: Mapped[str | None] = mapped_column(String(100), nullable=True)
    part_structure: Mapped[str | None] = mapped_column(String(100), nullable=True)
    time_signature: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_crooked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
