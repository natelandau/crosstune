"""A right to a paid feature, issued by the trial, a comp, or a billing provider."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, CheckConstraint, DateTime, ForeignKey, Index, String, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, new_uuid7, utc_now
from crosstune.models._checks import in_list
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource


class Grant(Base):
    """One grant. Server-only: clients read the resolved entitlement, never grants."""

    __tablename__ = "grants"
    __table_args__ = (
        CheckConstraint(in_list("kind", tuple(GrantKind), nullable=False), name="ck_grants_kind"),
        CheckConstraint(
            in_list("source", tuple(GrantSource), nullable=False), name="ck_grants_source"
        ),
        CheckConstraint(
            in_list("environment", tuple(GrantEnvironment), nullable=False),
            name="ck_grants_environment",
        ),
        Index("ix_grants_user_id", "user_id"),
        # Billing providers renew one grant per subscription, so only server-issued
        # sources are held to a single grant per kind.
        Index(
            "ux_grants_user_kind_source_server",
            "user_id",
            "kind",
            "source",
            unique=True,
            postgresql_where=text("source in ('trial', 'comp')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    source: Mapped[str] = mapped_column(String(20), nullable=False)
    environment: Mapped[str] = mapped_column(
        String(20), nullable=False, default=GrantEnvironment.PRODUCTION.value
    )
    # Null means the grant never lapses.
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    auto_renews: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    granted_by: Mapped[str | None] = mapped_column(String(100), nullable=True)
    reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
