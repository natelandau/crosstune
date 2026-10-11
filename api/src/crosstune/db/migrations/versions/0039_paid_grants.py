"""one grant per paid subscription

Revision ID: 0039
Revises: 0038
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_index(
        "ux_grants_source_external_id",
        "grants",
        ["source", "external_id"],
        unique=True,
        postgresql_where=sa.text("source in ('apple', 'stripe')"),
    )
    op.create_check_constraint(
        "ck_grants_paid_external_id",
        "grants",
        "source not in ('apple', 'stripe') or external_id is not null",
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_constraint("ck_grants_paid_external_id", "grants", type_="check")
    op.drop_index("ux_grants_source_external_id", table_name="grants")
