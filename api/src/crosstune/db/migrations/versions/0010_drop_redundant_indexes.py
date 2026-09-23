"""drop single-column indexes a composite (owner, server_seq) index already covers

Revision ID: 0010
Revises: 0009
"""

from __future__ import annotations

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None

# Each column leads a composite index with server_seq, which serves a lookup on the column
# alone, so a separate index on it only costs every write.
REDUNDANT = (
    ("ix_songs_owner_user_id", "songs", "owner_user_id"),
    ("ix_user_songs_user_id", "user_songs", "user_id"),
    ("ix_recording_links_added_by_user_id", "recording_links", "added_by_user_id"),
    ("ix_lists_user_id", "lists", "user_id"),
    ("ix_list_items_list_id", "list_items", "list_id"),
    ("ix_recordings_user_id", "recordings", "user_id"),
)


def upgrade() -> None:
    for name, table, _ in REDUNDANT:
        op.drop_index(name, table_name=table)


def downgrade() -> None:
    for name, table, column in REDUNDANT:
        op.create_index(name, table, [column])
