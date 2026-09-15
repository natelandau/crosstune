"""recordings, jobs, upload slots, and the audio quality setting

Revision ID: 0006
Revises: 0005
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

SOURCES = ("microphone", "upload")
STATES = ("pending_upload", "uploaded", "processing", "ready", "failed")
QUALITIES = ("low", "standard", "high")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.create_table(
        "recordings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "song_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("songs.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("label", sa.String(200), nullable=True),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("state", sa.String(20), nullable=False, server_default="pending_upload"),
        sa.Column("duration_ms", sa.Integer, nullable=True),
        sa.Column("playback_key", sa.Text, nullable=True),
        sa.Column("playback_mime", sa.String(100), nullable=True),
        sa.Column("playback_bytes", sa.BigInteger, nullable=True),
        sa.Column("original_key", sa.Text, nullable=True),
        sa.Column("original_bytes", sa.BigInteger, nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.CheckConstraint(f"source in ({_quoted(SOURCES)})", name="ck_recordings_source"),
        sa.CheckConstraint(f"state in ({_quoted(STATES)})", name="ck_recordings_state"),
    )
    op.create_index("ix_recordings_user_id", "recordings", ["user_id"])
    op.create_index("ix_recordings_song_id", "recordings", ["song_id"])
    op.create_index("ix_recordings_user_id_server_seq", "recordings", ["user_id", "server_seq"])

    op.create_table(
        "jobs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recording_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recordings.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("locked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_jobs_recording_id", "jobs", ["recording_id"])
    op.create_index("ix_jobs_locked_until_created_at", "jobs", ["locked_until", "created_at"])

    op.create_table(
        "upload_slots",
        sa.Column(
            "recording_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("recordings.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("declared_bytes", sa.BigInteger, nullable=False),
        sa.Column("content_type", sa.String(100), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_upload_slots_user_id", "upload_slots", ["user_id"])

    op.add_column(
        "user_settings",
        sa.Column("audio_quality", sa.String(20), nullable=False, server_default="standard"),
    )
    op.create_check_constraint(
        "ck_user_settings_audio_quality",
        "user_settings",
        f"audio_quality in ({_quoted(QUALITIES)})",
    )


def downgrade() -> None:
    op.drop_constraint("ck_user_settings_audio_quality", "user_settings", type_="check")
    op.drop_column("user_settings", "audio_quality")
    op.drop_table("upload_slots")
    op.drop_table("jobs")
    op.drop_table("recordings")
