"""How much of the operator's daily Apple Maps quota each account, and the team, has spent."""

from __future__ import annotations

import uuid
from datetime import date

from sqlalchemy import BigInteger, CheckConstraint, Date, ForeignKey, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base
from crosstune.models._checks import in_list
from crosstune.vocabulary import MapsUsageKind


class MapsUsage(Base):
    """One day's count of one kind of Apple Maps use, for one account or, with no account, the team.

    Server-owned and never synced.
    """

    __tablename__ = "maps_usage"
    __table_args__ = (
        CheckConstraint(
            in_list("kind", tuple(MapsUsageKind), nullable=False), name="ck_maps_usage_kind"
        ),
        Index(
            "ux_maps_usage_user_kind_day",
            "user_id",
            "kind",
            "day",
            unique=True,
            postgresql_where=text("user_id is not null"),
        ),
        Index(
            "ux_maps_usage_team_kind_day",
            "kind",
            "day",
            unique=True,
            postgresql_where=text("user_id is null"),
        ),
        Index("ix_maps_usage_day", "day"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=True
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
