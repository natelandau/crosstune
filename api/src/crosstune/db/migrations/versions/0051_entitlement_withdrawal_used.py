"""whether the account has used its one withdrawal, on the synced entitlements row

Revision ID: 0051
Revises: 0050
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0051"
down_revision = "0050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "entitlements",
        sa.Column("withdrawal_used", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.execute(
        "update entitlements set withdrawal_used = true, server_seq = nextval('sync_seq') "
        "from users where users.id = entitlements.user_id and users.withdrew_at is not null"
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "withdrawal_used")
