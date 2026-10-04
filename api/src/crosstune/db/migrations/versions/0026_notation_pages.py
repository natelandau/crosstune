"""notation_pages

Revision ID: 0026
Revises: 0025
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None

STATES = ("pending_upload", "ready")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.create_table(
        "notation_pages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "tune_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("tunes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("width", sa.Integer, nullable=False),
        sa.Column("height", sa.Integer, nullable=False),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending_upload"),
        sa.Column("file_key", sa.Text, nullable=True),
        sa.Column("file_bytes", sa.BigInteger, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.CheckConstraint("width > 0", name="ck_notation_pages_width"),
        sa.CheckConstraint("height > 0", name="ck_notation_pages_height"),
        sa.CheckConstraint(f"state in ({_quoted(STATES)})", name="ck_notation_pages_state"),
    )
    op.create_index("ix_notation_pages_tune_id", "notation_pages", ["tune_id"])
    op.create_index(
        "ix_notation_pages_user_id_server_seq", "notation_pages", ["user_id", "server_seq"]
    )


def downgrade() -> None:
    op.drop_table("notation_pages")
