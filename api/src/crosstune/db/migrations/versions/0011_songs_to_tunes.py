"""rename songs to tunes

Revision ID: 0011
Revises: 0010
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

TABLES = (("songs", "tunes"), ("user_songs", "user_tunes"))

# (table after the rename, old column, new column)
COLUMNS = (
    ("user_tunes", "song_id", "tune_id"),
    ("recording_links", "song_id", "tune_id"),
    ("recordings", "song_id", "tune_id"),
    ("list_items", "user_song_id", "user_tune_id"),
)

# (table after the rename, old name, new name). Renaming a primary key or unique constraint
# renames the index behind it. Every name follows its table so the models, which derive
# these names, describe the database exactly.
CONSTRAINTS = (
    ("tunes", "songs_pkey", "tunes_pkey"),
    ("tunes", "songs_owner_user_id_fkey", "tunes_owner_user_id_fkey"),
    ("tunes", "songs_merged_into_id_fkey", "tunes_merged_into_id_fkey"),
    ("tunes", "ck_songs_mode", "ck_tunes_mode"),
    ("tunes", "ck_songs_time_signature", "ck_tunes_time_signature"),
    ("user_tunes", "user_songs_pkey", "user_tunes_pkey"),
    ("user_tunes", "user_songs_user_id_fkey", "user_tunes_user_id_fkey"),
    ("user_tunes", "user_songs_song_id_fkey", "user_tunes_tune_id_fkey"),
    ("user_tunes", "uq_user_songs_user_song", "uq_user_tunes_user_tune"),
    ("user_tunes", "ck_user_songs_status", "ck_user_tunes_status"),
    ("recording_links", "recording_links_song_id_fkey", "recording_links_tune_id_fkey"),
    ("recordings", "recordings_song_id_fkey", "recordings_tune_id_fkey"),
    ("list_items", "list_items_user_song_id_fkey", "list_items_user_tune_id_fkey"),
)

INDEXES = (
    ("ix_songs_owner_user_id_server_seq", "ix_tunes_owner_user_id_server_seq"),
    ("ix_user_songs_user_id_server_seq", "ix_user_tunes_user_id_server_seq"),
    ("ix_user_songs_song_id", "ix_user_tunes_tune_id"),
    ("ix_recording_links_song_id", "ix_recording_links_tune_id"),
    ("ix_recordings_song_id", "ix_recordings_tune_id"),
    ("ix_list_items_user_song_id", "ix_list_items_user_tune_id"),
)

# Tables a NOT NULL constraint could be discovered on below, as scalar regclass casts
# comma-joined for an IN list.
RENAMED_TABLES = (
    "'tunes'::regclass, 'user_tunes'::regclass, 'recording_links'::regclass, "
    "'recordings'::regclass, 'list_items'::regclass"
)


def upgrade() -> None:
    # Fail fast instead of queuing every query behind these renames' ACCESS EXCLUSIVE locks.
    op.execute("set local lock_timeout = '10s'")
    for old, new in TABLES:
        op.rename_table(old, new)
    for table, old, new in COLUMNS:
        op.alter_column(table, old, new_column_name=new)

    # Postgres 18+ names every NOT NULL constraint after its table and column; older
    # versions have none. Discover them instead of listing them so the migration works
    # on both.
    bind = op.get_bind()
    not_null = bind.execute(
        text(
            "select conrelid::regclass::text, conname from pg_constraint "
            "where contype = 'n' and conname like '%song%' "
            f"and conrelid in ({RENAMED_TABLES})"
        )
    ).all()
    for table, old in not_null:
        new = old.replace("song", "tune")
        op.execute(f'alter table {table} rename constraint "{old}" to "{new}"')

    for table, old, new in CONSTRAINTS:
        op.execute(f'alter table {table} rename constraint "{old}" to "{new}"')
    for old, new in INDEXES:
        op.execute(f'alter index "{old}" rename to "{new}"')


def downgrade() -> None:
    # Fail fast instead of queuing every query behind these renames' ACCESS EXCLUSIVE locks.
    op.execute("set local lock_timeout = '10s'")
    for old, new in INDEXES:
        op.execute(f'alter index "{new}" rename to "{old}"')
    for table, old, new in CONSTRAINTS:
        op.execute(f'alter table {table} rename constraint "{new}" to "{old}"')

    # Found by pattern, since the listed names are already reverted.
    bind = op.get_bind()
    not_null = bind.execute(
        text(
            "select conrelid::regclass::text, conname from pg_constraint "
            "where contype = 'n' "
            f"and conrelid in ({RENAMED_TABLES}) "
            "and (conname ~ '^tunes_' or conname ~ '^user_tunes_' "
            "or conname ~ '_tune_id_' or conname ~ '_user_tune_id_')"
        )
    ).all()
    for table, new in not_null:
        old = new.replace("tune", "song")
        op.execute(f'alter table {table} rename constraint "{new}" to "{old}"')

    for table, old, new in COLUMNS:
        op.alter_column(table, new, new_column_name=old)
    for old, new in TABLES:
        op.rename_table(new, old)
