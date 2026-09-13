"""Account-level preferences. One row per user, created and edited by the client."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns

INSTRUMENTS: tuple[str, ...] = (
    "violin",
    "banjo",
    "guitar",
    "mandolin",
    "ukulele",
    "bass",
    "dulcimer",
    "accordion",
    "other",
)


class UserSettings(SyncColumns, Base):
    """The instruments a user plays. Clients derive the id from the user so every device agrees."""

    __tablename__ = "user_settings"
    # One row per user, so the unique index alone serves pulls scoped by user and server_seq.
    __table_args__ = (UniqueConstraint("user_id", name="uq_user_settings_user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    instruments: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False, default=list)
