"""A PostHog person still to delete for an account that is gone."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, new_uuid7, utc_now


class AnalyticsDeletion(Base):
    """One pass of deleting a person from PostHog, run and retried by the job runner.

    Deleted once PostHog confirms the delete, or once its attempts run out. Not synced.
    """

    __tablename__ = "analytics_deletions"
    __table_args__ = (Index("ix_analytics_deletions_locked_until", "locked_until"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    # The Clerk user id, which the apps send to PostHog as the person's distinct id.
    distinct_id: Mapped[str] = mapped_column(String(64), nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    # Null or past: due now. A later time holds the pass back, for a delay or a retry.
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )
