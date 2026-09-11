"""catalog tables: songs, user_songs, recording_links, lists, list_items

Revision ID: 0002
Revises: 0001
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

def _sync_columns() -> list[sa.Column]:
    """Fresh Column objects per call, since a Column may only belong to one table."""
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
    ]


def upgrade() -> None:
    op.create_table(
        "songs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("owner_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=True),
        sa.Column("merged_into_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="SET NULL"), nullable=True),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("alternate_titles", postgresql.ARRAY(sa.String(200)), nullable=False, server_default="{}"),
        sa.Column("genre", sa.String(100), nullable=True),
        sa.Column("feel", sa.String(100), nullable=True),
        sa.Column("has_lyrics", sa.Boolean, nullable=True),
        sa.Column("key", sa.String(10), nullable=True),
        sa.Column("mode", sa.String(20), nullable=True),
        sa.Column("tuning", sa.String(100), nullable=True),
        sa.Column("part_structure", sa.String(100), nullable=True),
        sa.Column("time_signature", sa.String(10), nullable=True),
        sa.Column("is_crooked", sa.Boolean, nullable=False, server_default=sa.false()),
        *_sync_columns(),
        sa.CheckConstraint(
            "mode is null or mode in ('major', 'minor', 'mixolydian', 'dorian', 'other')",
            name="ck_songs_mode",
        ),
        sa.CheckConstraint(
            "time_signature is null or time_signature in ('4/4', '2/4', '2/2', '3/4', '6/8', '9/8', '12/8', 'other')",
            name="ck_songs_time_signature",
        ),
    )
    op.create_index("ix_songs_owner_user_id", "songs", ["owner_user_id"])
    op.create_index("ix_songs_owner_user_id_server_seq", "songs", ["owner_user_id", "server_seq"])

    op.create_table(
        "user_songs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("song_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("learned_from", sa.String(200), nullable=True),
        sa.Column("learned_on", sa.Date, nullable=True),
        sa.Column("notes", sa.Text, nullable=True),
        sa.Column("archived_at", sa.DateTime(timezone=True), nullable=True),
        *_sync_columns(),
        sa.UniqueConstraint("user_id", "song_id", name="uq_user_songs_user_song"),
        sa.CheckConstraint("status in ('known', 'learning', 'want_to_learn')", name="ck_user_songs_status"),
    )
    op.create_index("ix_user_songs_user_id", "user_songs", ["user_id"])
    op.create_index("ix_user_songs_song_id", "user_songs", ["song_id"])
    op.create_index("ix_user_songs_user_id_server_seq", "user_songs", ["user_id", "server_seq"])

    op.create_table(
        "recording_links",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("song_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("added_by_user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("provider_ref", sa.String(200), nullable=True),
        sa.Column("title", sa.String(300), nullable=True),
        sa.Column("artwork_url", sa.Text, nullable=True),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        *_sync_columns(),
        sa.CheckConstraint(
            "provider in ('youtube', 'spotify', 'apple_music', 'bandcamp', 'soundcloud', 'other')",
            name="ck_recording_links_provider",
        ),
    )
    op.create_index("ix_recording_links_song_id", "recording_links", ["song_id"])
    op.create_index("ix_recording_links_added_by_user_id", "recording_links", ["added_by_user_id"])
    op.create_index(
        "ix_recording_links_added_by_user_id_server_seq",
        "recording_links",
        ["added_by_user_id", "server_seq"],
    )

    op.create_table(
        "lists",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        *_sync_columns(),
    )
    op.create_index("ix_lists_user_id", "lists", ["user_id"])
    op.create_index("ix_lists_user_id_server_seq", "lists", ["user_id", "server_seq"])

    op.create_table(
        "list_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("list_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("lists.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_song_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("user_songs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        *_sync_columns(),
    )
    op.create_index("ix_list_items_list_id", "list_items", ["list_id"])
    op.create_index("ix_list_items_user_song_id", "list_items", ["user_song_id"])
    op.create_index("ix_list_items_list_id_server_seq", "list_items", ["list_id", "server_seq"])


def downgrade() -> None:
    for table in ("list_items", "lists", "recording_links", "user_songs", "songs"):
        op.drop_table(table)
