"""recordings.received_at, when the server first stored each row, and an index on waiting pieces

Revision ID: 0063
Revises: 0062
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    # now() is stable, so existing rows take the migration's time without a table rewrite.
    op.add_column(
        "recordings",
        sa.Column(
            "received_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_recordings_waiting_pieces",
        "recordings",
        ["received_at"],
        postgresql_where=sa.text("state = 'processing' and split_from_id is not null"),
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_index("ix_recordings_waiting_pieces", table_name="recordings")
    op.drop_column("recordings", "received_at")
