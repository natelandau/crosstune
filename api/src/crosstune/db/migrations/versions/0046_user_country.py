"""country of each account's latest sync

Revision ID: 0046
Revises: 0045
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column("users", sa.Column("country", sa.CHAR(2), nullable=True))


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("users", "country")
