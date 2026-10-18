"""when a withdrawal's refund went through, and the Stripe item it refunded

Revision ID: 0048
Revises: 0047
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column("grants", sa.Column("refunded_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("grants", sa.Column("store_id", sa.String(255), nullable=True))


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("grants", "store_id")
    op.drop_column("grants", "refunded_at")
