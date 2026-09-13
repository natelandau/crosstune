"""one tuning column per instrument on songs

Revision ID: 0003
Revises: 0002
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.alter_column("songs", "tuning", new_column_name="violin_tuning")
    op.add_column("songs", sa.Column("banjo_tuning", sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column("songs", "banjo_tuning")
    op.alter_column("songs", "violin_tuning", new_column_name="tuning")
