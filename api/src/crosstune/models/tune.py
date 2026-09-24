"""A tune with all of its musical facets."""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Boolean, CheckConstraint, ForeignKey, Index, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list
from crosstune.vocabulary import LIMITS, Mode, TimeSignature

TUNE = LIMITS["tunes"]


class Tune(SyncColumns, Base):
    """One tune. owner_user_id is null only for a future shared catalog entry."""

    __tablename__ = "tunes"
    __table_args__ = (
        CheckConstraint(in_list("mode", tuple(Mode)), name="ck_tunes_mode"),
        CheckConstraint(
            in_list("time_signature", tuple(TimeSignature)), name="ck_tunes_time_signature"
        ),
        CheckConstraint("jsonb_typeof(tunings) = 'object'", name="ck_tunes_tunings"),
        Index("ix_tunes_owner_user_id_server_seq", "owner_user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    merged_into_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tunes.id", ondelete="SET NULL"), nullable=True
    )
    title: Mapped[str] = mapped_column(String(TUNE["title"]), nullable=False)
    alternate_titles: Mapped[list[str]] = mapped_column(
        ARRAY(String(TUNE["alternate_titles"])), nullable=False, default=list
    )
    genre: Mapped[str | None] = mapped_column(String(TUNE["genre"]), nullable=True)
    feel: Mapped[str | None] = mapped_column(String(TUNE["feel"]), nullable=True)
    lyrics: Mapped[str | None] = mapped_column(Text, nullable=True)
    key: Mapped[str | None] = mapped_column(String(TUNE["key"]), nullable=True)
    mode: Mapped[str | None] = mapped_column(String(20), nullable=True)
    tunings: Mapped[dict[str, Any]] = mapped_column(
        JSONB, nullable=False, default=dict, server_default=text("'{}'::jsonb")
    )
    part_structure: Mapped[str | None] = mapped_column(
        String(TUNE["part_structure"]), nullable=True
    )
    time_signature: Mapped[str | None] = mapped_column(String(10), nullable=True)
    is_crooked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
