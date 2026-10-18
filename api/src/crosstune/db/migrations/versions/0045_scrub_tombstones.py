"""clear the content of rows already soft-deleted

Revision ID: 0045
Revises: 0044
"""

from __future__ import annotations

from alembic import op

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None

# The values are literals, not imports, so the migration keeps meaning what it meant when it ran.
# A fresh server_seq makes clients pull the cleared row, and updated_at stays the row's.
_BUMP = "server_seq = nextval('sync_seq')"


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.execute(
        f"""
        update tunes
        set title = 'deleted', alternate_titles = '{{}}', tunings = '{{}}'::jsonb,
            modes = '{{}}', genre = null, tune_type = null, part_structure = null,
            composer = null, key = null, lyrics = null, time_signature = null, {_BUMP}
        where deleted_at is not null
        """
    )
    op.execute(
        f"""
        update user_tunes set learned_from = null, notes = null, {_BUMP}
        where deleted_at is not null
        """
    )
    op.execute(f"update lists set name = 'deleted', {_BUMP} where deleted_at is not null")
    op.execute(
        f"""
        update recording_links
        set url = 'https://crosstune.app/deleted', provider_ref = null, title = null,
            artwork_url = null, {_BUMP}
        where deleted_at is not null
        """
    )
    # An imported recording keeps a URL so ck_recordings_origin_url still holds.
    op.execute(
        f"""
        update recordings
        set label = null, error = null,
            origin_url = case when origin_url is null then null
                else 'https://crosstune.app/deleted' end,
            {_BUMP}
        where deleted_at is not null
        """
    )
    op.execute(
        f"""
        update recording_loops set label = null, {_BUMP}
        where deleted_at is not null
          and recording_id in (select id from recordings where deleted_at is not null)
        """
    )


def downgrade() -> None:
    # Cleared content cannot come back.
    pass
