"""drop feel and the single mode

Revision ID: 0015
Revises: 0014
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

MODES = ("major", "minor", "mixolydian", "dorian", "modal", "other")


def upgrade() -> None:
    op.drop_constraint("ck_tunes_mode", "tunes", type_="check")
    op.drop_column("tunes", "mode")
    op.drop_column("tunes", "feel")


def downgrade() -> None:
    op.add_column("tunes", sa.Column("feel", sa.String(100), nullable=True))
    op.add_column("tunes", sa.Column("mode", sa.String(20), nullable=True))
    # Postgres arrays are 1-indexed, and an empty array's first element is null.
    op.execute("update tunes set feel = tune_type, mode = modes[1]")
    quoted = ", ".join(f"'{mode}'" for mode in MODES)
    op.create_check_constraint("ck_tunes_mode", "tunes", f"mode is null or mode in ({quoted})")
