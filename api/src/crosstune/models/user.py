"""A Crosstune account, keyed to a Clerk user."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column
from uuid_utils import uuid7

from crosstune.db.base import Base


def utc_now() -> datetime:
    """Timezone-aware timestamp for row creation and update columns."""
    return datetime.now(UTC)


def new_uuid7() -> uuid.UUID:
    """Time-ordered id for rows the server generates, keyed to insertion order."""
    return uuid.UUID(bytes=uuid7().bytes)


class User(Base):
    """One account. The id is server-generated; every other table's ids come from clients."""

    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    clerk_user_id: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False
    )
