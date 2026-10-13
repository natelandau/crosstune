"""trial start on entitlements, backfilled from each trial grant

Revision ID: 0041
Revises: 0040
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "entitlements",
        sa.Column("trial_starts_at", sa.DateTime(timezone=True), nullable=True),
    )
    # A fresh server_seq makes clients pull the start; updated_at stays the row's.
    op.execute(
        """
        update entitlements e
        set trial_starts_at = g.created_at, server_seq = nextval('sync_seq')
        from grants g
        where g.user_id = e.user_id and g.kind = 'premium' and g.source = 'trial'
        """
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "trial_starts_at")
