"""job turns, the last claim each account's jobs got, so claims rotate across accounts

Revision ID: 0062
Revises: 0061
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.schema.CreateSequence(sa.Sequence("job_turn_seq", start=1)))
    op.create_table(
        "job_turns",
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("background", sa.Boolean(), primary_key=True),
        sa.Column("last_turn", sa.BigInteger(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("job_turns")
    op.execute(sa.schema.DropSequence(sa.Sequence("job_turn_seq")))
