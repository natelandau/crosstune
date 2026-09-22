"""modal as a song mode

Revision ID: 0009
Revises: 0008
"""

from __future__ import annotations

from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None

OLD_MODES = ("major", "minor", "mixolydian", "dorian", "other")
NEW_MODES = ("major", "minor", "mixolydian", "dorian", "modal", "other")


def _replace_mode_constraint(modes: tuple[str, ...]) -> None:
    op.drop_constraint("ck_songs_mode", "songs", type_="check")
    quoted = ", ".join(f"'{mode}'" for mode in modes)
    op.create_check_constraint("ck_songs_mode", "songs", f"mode is null or mode in ({quoted})")


def upgrade() -> None:
    _replace_mode_constraint(NEW_MODES)


def downgrade() -> None:
    # A fresh server_seq is what makes clients pull the changed row.
    op.execute(
        "update songs set mode = 'other', updated_at = now(), server_seq = nextval('sync_seq') "
        "where mode = 'modal'"
    )
    _replace_mode_constraint(OLD_MODES)
