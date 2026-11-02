"""the mono job kind, queued once for every recording whose mono flag is unmeasured

Revision ID: 0061
Revises: 0060
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None

OLD_KINDS = ("transcode", "trim", "peaks", "import", "reencode", "place", "split")
NEW_KINDS = (*OLD_KINDS, "mono")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(NEW_KINDS)})")
    op.create_index(
        "ux_jobs_recording_id_mono",
        "jobs",
        ["recording_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'mono'"),
    )

    # Playback files transcoded before the server measured mono; the web client never does.
    op.execute(
        "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) "
        "select gen_random_uuid(), id, user_id, 'mono', 0, now() "
        "from recordings "
        "where deleted_at is null and playback_key is not null and is_mono is null"
    )


def downgrade() -> None:
    # A pre-0061 runner has no mono kind; an unmeasured recording keeps its stereo control.
    op.execute("set local lock_timeout = '10s'")
    op.execute("delete from jobs where kind = 'mono'")
    op.drop_index("ux_jobs_recording_id_mono", table_name="jobs")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(OLD_KINDS)})")
