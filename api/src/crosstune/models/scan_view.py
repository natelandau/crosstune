"""One look at a tune's scans, kept as history."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, CheckConstraint, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, sync_seq
from crosstune.models._checks import in_list
from crosstune.vocabulary import ScanViewContext


class ScanView(Base):
    """Parents carry no foreign keys: a push checks them, and a row outlives a parent's removal."""

    __tablename__ = "scan_views"
    __table_args__ = (
        CheckConstraint(
            in_list("context", tuple(ScanViewContext), nullable=False),
            name="ck_scan_views_context",
        ),
        CheckConstraint(
            "list_id is null or context = 'list'", name="ck_scan_views_list_id_context"
        ),
        CheckConstraint("viewed_ms >= 0", name="ck_scan_views_viewed_ms"),
        Index("ix_scan_views_user_id_server_seq", "user_id", "server_seq"),
        Index("ix_scan_views_user_id_started_at", "user_id", "started_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tune_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    context: Mapped[str] = mapped_column(String(20), nullable=False)
    list_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    viewed_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    server_seq: Mapped[int] = mapped_column(
        BigInteger, sync_seq, server_default=sync_seq.next_value(), nullable=False
    )
