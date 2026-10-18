"""subscription start, billing period, and withdrawal on grants, users, and entitlements

Revision ID: 0047
Revises: 0046
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column("grants", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("grants", sa.Column("period", sa.String(10), nullable=True))
    op.add_column("grants", sa.Column("withdrawn_at", sa.DateTime(timezone=True), nullable=True))
    op.create_check_constraint(
        "ck_grants_period", "grants", "period is null or period in ('month', 'year')"
    )
    op.add_column("users", sa.Column("withdrew_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        "entitlements", sa.Column("withdraw_until", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "withdraw_until")
    op.drop_column("users", "withdrew_at")
    op.drop_constraint("ck_grants_period", "grants", type_="check")
    op.drop_column("grants", "withdrawn_at")
    op.drop_column("grants", "period")
    op.drop_column("grants", "started_at")
