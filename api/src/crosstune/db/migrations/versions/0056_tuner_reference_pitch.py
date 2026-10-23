"""user_settings tuner reference pitch

Revision ID: 0056
Revises: 0055
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "user_settings",
        sa.Column("tuner_a4_hz", sa.Integer(), nullable=False, server_default="440"),
    )
    op.create_check_constraint(
        "ck_user_settings_tuner_a4_hz", "user_settings", "tuner_a4_hz between 430 and 450"
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_constraint("ck_user_settings_tuner_a4_hz", "user_settings", type_="check")
    op.drop_column("user_settings", "tuner_a4_hz")
