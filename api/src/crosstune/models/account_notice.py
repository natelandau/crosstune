"""The record of an operator-sent email to an account, so a rerun skips it."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, utc_now


class AccountNotice(Base):
    """One email an operator sent to an account about a change to the terms or privacy policy.

    Removed with the account, so deletion keeps nothing of it. Not synced.
    """

    __tablename__ = "account_notices"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    # The operator's name for one announcement, such as "terms-2027-04".
    notice_key: Mapped[str] = mapped_column(String(100), primary_key=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
