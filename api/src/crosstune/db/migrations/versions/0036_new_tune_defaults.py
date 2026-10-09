"""user_settings genre and status a new tune starts with

Revision ID: 0036
Revises: 0035
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None

STATUSES = ("known", "learning", "want_to_learn")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.add_column("user_settings", sa.Column("new_tune_genre", sa.String(100), nullable=True))
    op.add_column(
        "user_settings",
        sa.Column(
            "new_tune_status", sa.String(20), nullable=False, server_default="want_to_learn"
        ),
    )
    op.create_check_constraint(
        "ck_user_settings_new_tune_status",
        "user_settings",
        f"new_tune_status in ({_quoted(STATUSES)})",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_settings_new_tune_status", "user_settings", type_="check")
    op.drop_column("user_settings", "new_tune_status")
    op.drop_column("user_settings", "new_tune_genre")
