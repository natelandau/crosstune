"""A comp promised to an email address that has no account yet."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, new_uuid7, utc_now


class PendingComp(Base):
    """Becomes a comp grant when an account signs up with this email."""

    __tablename__ = "pending_comps"
    __table_args__ = (CheckConstraint("email = lower(email)", name="ck_pending_comps_email_lower"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    storage_addon: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    granted_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
