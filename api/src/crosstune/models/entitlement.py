"""What a user's plan allows right now, resolved from their grants and synced to clients."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns, new_uuid7
from crosstune.models._checks import in_list
from crosstune.vocabulary import GrantSource


class Entitlement(SyncColumns, Base):
    """One row per user. The server writes it; the notice timestamps record what a user saw."""

    __tablename__ = "entitlements"
    # One row per user, so the unique index alone serves pulls scoped by user and server_seq.
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_entitlements_user_id"),
        CheckConstraint(
            in_list("premium_source", tuple(GrantSource)), name="ck_entitlements_premium_source"
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    # Null when no premium grant is active.
    premium_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    premium_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    auto_renews: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    trial_ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    premium_quota_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    free_quota_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    recording_notice_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    trial_reminder_seen_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
