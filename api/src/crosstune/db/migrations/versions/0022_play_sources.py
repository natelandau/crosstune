"""user_tunes play pin and user_settings play_first

Revision ID: 0022
Revises: 0021
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None

PLAY_FIRST = ("recordings", "apple_music")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.add_column("user_tunes", sa.Column("play_recording_id", postgresql.UUID, nullable=True))
    op.add_column("user_tunes", sa.Column("play_link_id", postgresql.UUID, nullable=True))
    op.create_check_constraint(
        "ck_user_tunes_one_play_source",
        "user_tunes",
        "num_nonnulls(play_recording_id, play_link_id) <= 1",
    )
    op.add_column(
        "user_settings",
        sa.Column("play_first", sa.String(20), nullable=False, server_default="recordings"),
    )
    op.create_check_constraint(
        "ck_user_settings_play_first", "user_settings", f"play_first in ({_quoted(PLAY_FIRST)})"
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_settings_play_first", "user_settings", type_="check")
    op.drop_column("user_settings", "play_first")
    op.drop_constraint("ck_user_tunes_one_play_source", "user_tunes", type_="check")
    op.drop_column("user_tunes", "play_link_id")
    op.drop_column("user_tunes", "play_recording_id")
