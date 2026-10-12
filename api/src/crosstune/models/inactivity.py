"""Stored state for the inactive-account pass."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base


class InactivityNotice(Base):
    """The warnings sent to one inactive account about deleting its recordings and scans.

    Removed when the account turns active again. Not synced.
    """

    __tablename__ = "inactivity_notices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The activity instant the warnings count from. A later activity makes the row stale.
    active_since: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # Null until Resend accepted the warning.
    first_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    second_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # The earliest the account's files may be deleted. Recorded with the first warning and
    # pushed later by the second when needed. Null only before the first warning.
    deletion_due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class ScheduledRun(Base):
    """When a named periodic pass is next due, kept so a restart neither skips nor repeats it."""

    __tablename__ = "scheduled_runs"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    next_run_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
