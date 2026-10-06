"""A denylist of Clerk ids whose Crosstune account was purged."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, utc_now


class DeletedAccount(Base):
    """One purged Clerk id, kept so a re-issued token for it can never re-create an account."""

    __tablename__ = "deleted_accounts"

    clerk_user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    deleted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
