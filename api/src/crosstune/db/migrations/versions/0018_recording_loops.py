"""recording_loops table

Revision ID: 0018
Revises: 0017
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

MIN_LOOP_MS = 500
LOOP_COLOR_COUNT = 6
LABEL_LENGTH = 100


def upgrade() -> None:
    op.create_table(
        "recording_loops",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "recording_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recordings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("label", sa.String(LABEL_LENGTH), nullable=True),
        sa.Column("start_ms", sa.Integer, nullable=False),
        sa.Column("end_ms", sa.Integer, nullable=False),
        sa.Column("color", sa.SmallInteger, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.CheckConstraint("start_ms >= 0", name="ck_recording_loops_start_ms"),
        sa.CheckConstraint(
            f"deleted_at IS NOT NULL OR end_ms - start_ms >= {MIN_LOOP_MS}",
            name="ck_recording_loops_min_length",
        ),
        sa.CheckConstraint(
            f"color between 0 and {LOOP_COLOR_COUNT - 1}", name="ck_recording_loops_color"
        ),
    )
    op.create_index("ix_recording_loops_recording_id", "recording_loops", ["recording_id"])
    op.create_index(
        "ix_recording_loops_user_id_server_seq", "recording_loops", ["user_id", "server_seq"]
    )


def downgrade() -> None:
    op.drop_index("ix_recording_loops_user_id_server_seq", table_name="recording_loops")
    op.drop_index("ix_recording_loops_recording_id", table_name="recording_loops")
    op.drop_table("recording_loops")
