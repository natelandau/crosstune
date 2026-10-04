"""the reencode job kind, queued once for every recording with an original

Revision ID: 0030
Revises: 0029
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None

OLD_KINDS = ("transcode", "trim", "peaks", "import")
NEW_KINDS = (*OLD_KINDS, "reencode")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(NEW_KINDS)})")
    op.create_index(
        "ux_jobs_recording_id_reencode",
        "jobs",
        ["recording_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'reencode'"),
    )

    # Every playback file cut from an original before this revision was encoded at a
    # fixed rate; queue one re-cut each.
    op.execute(
        "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) "
        "select gen_random_uuid(), id, user_id, 'reencode', 0, now() "
        "from recordings where deleted_at is null and state = 'ready' and original_key is not null"
    )


def downgrade() -> None:
    # A pre-0030 runner has no reencode kind; the recording keeps playing its current file.
    op.execute("delete from jobs where kind = 'reencode'")
    op.drop_index("ux_jobs_recording_id_reencode", table_name="jobs")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(OLD_KINDS)})")
