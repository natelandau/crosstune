"""the place job kind, which names a recording's coordinates

Revision ID: 0053
Revises: 0052
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None

OLD_KINDS = ("transcode", "trim", "peaks", "import", "reencode")
NEW_KINDS = (*OLD_KINDS, "place")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(NEW_KINDS)})")
    op.create_index(
        "ux_jobs_recording_id_place",
        "jobs",
        ["recording_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'place'"),
    )


def downgrade() -> None:
    # A pre-0053 runner has no place kind; the coordinates stay unnamed.
    op.execute("delete from jobs where kind = 'place'")
    op.drop_index("ux_jobs_recording_id_place", table_name="jobs")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(OLD_KINDS)})")
