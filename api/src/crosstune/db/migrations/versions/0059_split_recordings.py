"""split columns on recordings and the split job kind

Revision ID: 0059
Revises: 0058
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None

OLD_KINDS = ("transcode", "trim", "peaks", "import", "reencode", "place")
NEW_KINDS = (*OLD_KINDS, "split")

CHECKS = {
    "ck_recordings_split_size": "split_size between 2 and 50",
    "ck_recordings_split_pair": "(split_id is null) = (split_size is null)",
    "ck_recordings_source_offset_ms": "source_offset_ms >= 0",
}


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "recordings",
        sa.Column(
            "split_from_id",
            UUID(as_uuid=True),
            sa.ForeignKey("recordings.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_recordings_split_from_id", "recordings", ["split_from_id"])
    op.add_column("recordings", sa.Column("split_id", UUID(as_uuid=True), nullable=True))
    op.add_column("recordings", sa.Column("split_size", sa.SmallInteger(), nullable=True))
    op.add_column(
        "recordings", sa.Column("created_by_split_id", UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "recordings", sa.Column("split_completed_id", UUID(as_uuid=True), nullable=True)
    )
    op.add_column(
        "recordings",
        sa.Column("source_offset_ms", sa.Integer(), nullable=False, server_default="0"),
    )
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, "recordings", condition)
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(NEW_KINDS)})")
    op.create_index(
        "ux_jobs_recording_id_split",
        "jobs",
        ["recording_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'split'"),
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    # A pre-0059 runner has no split kind.
    op.execute("delete from jobs where kind = 'split'")
    op.drop_index("ux_jobs_recording_id_split", table_name="jobs")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(OLD_KINDS)})")
    for name in reversed(CHECKS):
        op.drop_constraint(name, "recordings", type_="check")
    op.drop_index("ix_recordings_split_from_id", table_name="recordings")
    for column in (
        "source_offset_ms",
        "split_completed_id",
        "created_by_split_id",
        "split_size",
        "split_id",
        "split_from_id",
    ):
        op.drop_column("recordings", column)
