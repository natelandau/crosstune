"""billing notices, the confirmation, reminder, and withdrawal emails already sent

Revision ID: 0049
Revises: 0048
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0049"
down_revision = "0048"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_table(
        "billing_notices",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("subscription_id", sa.String(255), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("period_end", sa.DateTime(timezone=True), nullable=True),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "kind in ('confirmation', 'renewal_reminder', 'withdrawal')",
            name="ck_billing_notices_kind",
        ),
        sa.UniqueConstraint(
            "subscription_id",
            "kind",
            "period_end",
            name="ux_billing_notices_subscription_kind_period_end",
            postgresql_nulls_not_distinct=True,
        ),
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_table("billing_notices")
