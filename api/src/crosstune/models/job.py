"""Server-owned bookkeeping for uploads, transcodes, and job claims. None of it is synced."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Sequence,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, new_uuid7, utc_now
from crosstune.models._checks import in_list
from crosstune.vocabulary import JobKind


class Job(Base):
    """Work waiting for the runner: one job of any `JobKind`.

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
        Index(
            "ux_jobs_recording_id_reencode",
            "recording_id",
            unique=True,
            postgresql_where=text(f"kind = '{JobKind.REENCODE.value}'"),
        ),
        Index(
            "ux_jobs_recording_id_place",
            "recording_id",
            unique=True,
            postgresql_where=text(f"kind = '{JobKind.PLACE.value}'"),
        ),
        Index(
            "ux_jobs_recording_id_split",
            "recording_id",
            unique=True,
            postgresql_where=text(f"kind = '{JobKind.SPLIT.value}'"),
        ),
        Index(
            "ux_jobs_recording_id_mono",
            "recording_id",
            unique=True,
            postgresql_where=text(f"kind = '{JobKind.MONO.value}'"),
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


# Numbers each claim, so the account whose last claim is oldest claims next. A counter,
# not a time, so claims in one instant and runners with drifting clocks still order.
job_claim_seq = Sequence("job_claim_seq", start=1)


class JobLastClaim(Base):
    """The last claim one account's foreground or background jobs got from the runner.

    Outlives the jobs it counts, which are deleted as they finish. Not synced.
    """

    __tablename__ = "job_last_claims"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    background: Mapped[bool] = mapped_column(Boolean, primary_key=True)
    claim_seq: Mapped[int] = mapped_column(BigInteger, nullable=False)


class UploadSlot(Base):
    """A presigned upload the client may still complete. Its declared size counts toward quota.

    Each slot belongs to exactly one recording or one scan, and each owner has
    at most one slot.
    """

    __tablename__ = "upload_slots"
    __table_args__ = (
        CheckConstraint(
            "num_nonnulls(recording_id, scan_id) = 1", name="ck_upload_slots_one_owner"
        ),
        UniqueConstraint("recording_id", name="uq_upload_slots_recording_id"),
        UniqueConstraint("scan_id", name="uq_upload_slots_scan_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    recording_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("recordings.id", ondelete="CASCADE"),
        nullable=True,
    )
    scan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scans.id", ondelete="CASCADE"),
        nullable=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    declared_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    content_type: Mapped[str] = mapped_column(String(100), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The key this slot's PUT URL is signed for, new on every issue.
    object_key: Mapped[str] = mapped_column(String(512), nullable=False)
    # SHA-256 hex of the token that confirms this upload without sign-in, new on every issue.
    # Null on a scan's slot, which only a signed-in call confirms.
    confirm_token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
