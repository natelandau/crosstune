"""trial end notice flag on entitlements

Revision ID: 0038
Revises: 0037
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "entitlements",
        sa.Column("trial_end_seen_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "trial_end_seen_at")
