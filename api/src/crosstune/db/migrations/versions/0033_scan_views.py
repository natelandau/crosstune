"""scan views, the history of looks at a tune's scans

Revision ID: 0033
Revises: 0032
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

SCAN_VIEW_CONTEXTS = ("tune", "row", "list")


def _in_list(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_table(
        "scan_views",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("tune_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("context", sa.String(20), nullable=False),
        sa.Column("list_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("viewed_ms", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.CheckConstraint(_in_list("context", SCAN_VIEW_CONTEXTS), name="ck_scan_views_context"),
        sa.CheckConstraint(
            "list_id is null or context = 'list'", name="ck_scan_views_list_id_context"
        ),
        sa.CheckConstraint("viewed_ms >= 0", name="ck_scan_views_viewed_ms"),
    )
    op.create_index("ix_scan_views_user_id_server_seq", "scan_views", ["user_id", "server_seq"])
    op.create_index("ix_scan_views_user_id_started_at", "scan_views", ["user_id", "started_at"])


def downgrade() -> None:
    op.drop_table("scan_views")
