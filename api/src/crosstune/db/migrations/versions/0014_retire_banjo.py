"""rename a banjo instrument value left in settings to five_string_banjo

Revision ID: 0014
Revises: 0013
"""

from __future__ import annotations

from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The API no longer reads banjo, so a row holding it would fail every pull. The rename
    # keeps first-seen order and merges a row that already holds five_string_banjo. A fresh
    # server_seq makes clients pull the row; updated_at stays, so last-write-wins still
    # orders it by the player's own edits.
    op.execute(
        "update user_settings set instruments = array("
        "select v from unnest(array_replace(instruments, 'banjo', 'five_string_banjo')) "
        "with ordinality as t(v, i) group by v order by min(i)), "
        "server_seq = nextval('sync_seq') "
        "where 'banjo' = any(instruments)"
    )


def downgrade() -> None:
    # A renamed value cannot be told from one written as five_string_banjo, and the API at
    # 0013 reads both, so there is nothing to restore.
    pass
