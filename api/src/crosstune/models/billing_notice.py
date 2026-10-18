"""The record of a billing email Resend accepted, so it is never sent twice."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, new_uuid7, utc_now
from crosstune.models._checks import in_list
from crosstune.vocabulary import BillingNoticeKind


class BillingNotice(Base):
    """One sent confirmation, renewal reminder, or withdrawal email. Not synced.

    Keyed by the store subscription, not the account: a subscription follows its buyer
    between accounts, and the withdrawal email of a deleted account is still recorded.
    """

    __tablename__ = "billing_notices"
    __table_args__ = (
        CheckConstraint(
            in_list("kind", tuple(BillingNoticeKind), nullable=False),
            name="ck_billing_notices_kind",
        ),
        UniqueConstraint(
            "subscription_id",
            "kind",
            "period_end",
            name="ux_billing_notices_subscription_kind_period_end",
            postgresql_nulls_not_distinct=True,
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=new_uuid7)
    # RevenueCat's subscription ID, the same as `grants.external_id`.
    subscription_id: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    # The renewal a reminder announces; null for a notice sent once per subscription.
    period_end: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utc_now, nullable=False
    )
