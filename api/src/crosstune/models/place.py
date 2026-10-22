"""A saved location a user names once and links their takes to."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, Double, ForeignKey, Index, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.vocabulary import LIMITS


class Place(SyncColumns, Base):
    """A named point. A recording keeps its own coordinates, so deleting a place unlinks it."""

    __tablename__ = "places"
    __table_args__ = (
        CheckConstraint(
            "lat between -90 and 90 and lon between -180 and 180", name="ck_places_range"
        ),
        Index("ix_places_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(LIMITS["places"]["name"]), nullable=False)
    lat: Mapped[float] = mapped_column(Double, nullable=False)
    lon: Mapped[float] = mapped_column(Double, nullable=False)
    address: Mapped[str | None] = mapped_column(String(LIMITS["places"]["address"]), nullable=True)
    apple_place_id: Mapped[str | None] = mapped_column(
        String(LIMITS["places"]["apple_place_id"]), nullable=True
    )
