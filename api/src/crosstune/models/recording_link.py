"""A pointer to a recording hosted elsewhere."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list

PROVIDERS: tuple[str, ...] = (
    "youtube",
    "spotify",
    "apple_music",
    "bandcamp",
    "soundcloud",
    "other",
)


class RecordingLink(SyncColumns, Base):
    """Attached to the song, with the user who added it, so links become shared value later."""

    __tablename__ = "recording_links"
    __table_args__ = (
        CheckConstraint(
            in_list("provider", PROVIDERS, nullable=False), name="ck_recording_links_provider"
        ),
        Index("ix_recording_links_added_by_user_id_server_seq", "added_by_user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    song_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("songs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    added_by_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    provider: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_ref: Mapped[str | None] = mapped_column(String(200), nullable=True)
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)
    artwork_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
