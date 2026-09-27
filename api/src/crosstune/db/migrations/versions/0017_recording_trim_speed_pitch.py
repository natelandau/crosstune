"""recording trim, speed, pitch, peaks columns, and job kinds

Revision ID: 0017
Revises: 0016
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None

JOB_KINDS = ("transcode", "trim", "peaks")
SPEED_PERCENT_MIN = 50
SPEED_PERCENT_MAX = 150
PITCH_CENTS_MIN = -1200
PITCH_CENTS_MAX = 1200


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.add_column(
        "recordings", sa.Column("trim_start_ms", sa.Integer, nullable=False, server_default="0")
    )
    op.add_column("recordings", sa.Column("trim_end_ms", sa.Integer, nullable=True))
    op.add_column(
        "recordings",
        sa.Column("speed_percent", sa.SmallInteger, nullable=False, server_default="100"),
    )
    op.add_column(
        "recordings", sa.Column("pitch_cents", sa.SmallInteger, nullable=False, server_default="0")
    )
    op.add_column("recordings", sa.Column("source_duration_ms", sa.Integer, nullable=True))
    op.add_column("recordings", sa.Column("playback_start_ms", sa.Integer, nullable=True))
    op.add_column("recordings", sa.Column("playback_end_ms", sa.Integer, nullable=True))
    op.add_column("recordings", sa.Column("playback_rev", sa.String(8), nullable=True))
    op.add_column("recordings", sa.Column("peaks_key", sa.Text, nullable=True))
    op.add_column("recordings", sa.Column("peaks_rev", sa.String(8), nullable=True))
    op.add_column("recordings", sa.Column("peaks_bytes", sa.BigInteger, nullable=True))
    op.create_check_constraint("ck_recordings_trim_start_ms", "recordings", "trim_start_ms >= 0")
    op.create_check_constraint(
        "ck_recordings_speed_percent",
        "recordings",
        f"speed_percent between {SPEED_PERCENT_MIN} and {SPEED_PERCENT_MAX}",
    )
    op.create_check_constraint(
        "ck_recordings_pitch_cents",
        "recordings",
        f"pitch_cents between {PITCH_CENTS_MIN} and {PITCH_CENTS_MAX}",
    )

    op.add_column(
        "jobs", sa.Column("kind", sa.String(20), nullable=False, server_default="transcode")
    )
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(JOB_KINDS)})")
    op.create_index(
        "ux_jobs_recording_id_trim",
        "jobs",
        ["recording_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'trim'"),
    )

    # No recording was trimmed before this revision, so every existing playback
    # file starts at its source's start and, when its length is known, covers the
    # whole source. A row with no length gets no range, so no trim is queued
    # against it until the peaks job below measures it. The existing key is kept,
    # so the revision is only a tag clients compare against what they downloaded.
    op.execute(
        "update recordings set source_duration_ms = duration_ms, playback_start_ms = 0, "
        "playback_end_ms = duration_ms, playback_rev = substr(md5(id::text), 1, 8) "
        "where state = 'ready'"
    )

    # Every existing ready recording has no peaks file yet; queue one build each.
    # The lock outlasts the deploy overlap: a runner from before this revision claims
    # any job regardless of kind and would run a peaks job as a transcode.
    op.execute(
        "insert into jobs (id, recording_id, user_id, kind, attempts, created_at, locked_until) "
        "select gen_random_uuid(), id, user_id, 'peaks', 0, now(), "
        "now() + interval '15 minutes' "
        "from recordings where deleted_at is null and state = 'ready'"
    )


def downgrade() -> None:
    # A pre-0017 job has no kind, so a trim or peaks job cannot survive the column drop.
    op.execute("delete from jobs where kind <> 'transcode'")
    op.drop_index("ux_jobs_recording_id_trim", table_name="jobs")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.drop_column("jobs", "kind")

    op.drop_constraint("ck_recordings_pitch_cents", "recordings", type_="check")
    op.drop_constraint("ck_recordings_speed_percent", "recordings", type_="check")
    op.drop_constraint("ck_recordings_trim_start_ms", "recordings", type_="check")
    op.drop_column("recordings", "peaks_bytes")
    op.drop_column("recordings", "peaks_rev")
    op.drop_column("recordings", "peaks_key")
    op.drop_column("recordings", "playback_rev")
    op.drop_column("recordings", "playback_end_ms")
    op.drop_column("recordings", "playback_start_ms")
    op.drop_column("recordings", "source_duration_ms")
    op.drop_column("recordings", "pitch_cents")
    op.drop_column("recordings", "speed_percent")
    op.drop_column("recordings", "trim_end_ms")
    op.drop_column("recordings", "trim_start_ms")
