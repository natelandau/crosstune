"""Server-owned bookkeeping for uploads and transcodes. Neither table is synced."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base
from crosstune.models._checks import in_list
from crosstune.models.user import new_uuid7, utc_now
from crosstune.vocabulary import JobKind


class Job(Base):
    """Work waiting for the runner: a transcode, a trim, or a peaks build.

    Deleted once the runner finishes the work it names.
    """

    __tablename__ = "jobs"
    __table_args__ = (
        Index("ix_jobs_locked_until_created_at", "locked_until", "created_at"),
        CheckConstraint(in_list("kind", tuple(JobKind), nullable=False), name="ck_jobs_kind"),
        # A recording can only ever have one trim in flight.
        Index(
            "ux_jobs_recording_id_trim",
            "recording_id",
            unique=True,
            postgresql_where=text(f"kind = '{JobKind.TRIM.value}'"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default=JobKind.TRANSCODE.value,
        server_default=JobKind.TRANSCODE.value,
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now
    )


class UploadSlot(Base):
    """A presigned upload the client may still complete. Its declared size counts toward quota."""

    __tablename__ = "upload_slots"

    recording_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("recordings.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    declared_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
