"""maps usage, each account's and the team's daily count of Apple Maps use

Revision ID: 0064
Revises: 0063
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "maps_usage",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "kind in ('service_call', 'mapkit_token', 'snapshot')", name="ck_maps_usage_kind"
        ),
    )
    op.create_index(
        "ux_maps_usage_user_kind_day",
        "maps_usage",
        ["user_id", "kind", "day"],
        unique=True,
        postgresql_where=sa.text("user_id is not null"),
    )
    op.create_index(
        "ux_maps_usage_team_kind_day",
        "maps_usage",
        ["kind", "day"],
        unique=True,
        postgresql_where=sa.text("user_id is null"),
    )
    op.create_index("ix_maps_usage_day", "maps_usage", ["day"])


def downgrade() -> None:
    op.drop_table("maps_usage")
