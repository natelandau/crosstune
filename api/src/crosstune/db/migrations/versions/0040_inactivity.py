"""inactivity notices and scheduled runs, the state the inactive-account pass keeps

Revision ID: 0040
Revises: 0039
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "inactivity_notices",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("active_since", sa.DateTime(timezone=True), nullable=False),
        sa.Column("first_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("second_sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_due_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "scheduled_runs",
        sa.Column("name", sa.String(64), primary_key=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("scheduled_runs")
    op.drop_table("inactivity_notices")
