"""recording added_at, and a nullable recorded_at with its precision

Revision ID: 0028
Revises: 0027
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

PRECISIONS = ("year", "month", "day", "time")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.add_column("recordings", sa.Column("added_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("recordings", sa.Column("recorded_precision", sa.String(10), nullable=True))
    op.alter_column("recordings", "recorded_at", nullable=True)
    # Until now recorded_at held the time a recording was created. Only a take's creation
    # is also when the music was played; an upload's or an import's is unknown.
    op.execute(
        "update recordings set added_at = recorded_at, "
        "recorded_at = case when source = 'microphone' then recorded_at end, "
        "recorded_precision = case when source = 'microphone' then 'time' end"
    )
    op.alter_column("recordings", "added_at", nullable=False)
    op.create_check_constraint(
        "ck_recordings_recorded_precision",
        "recordings",
        f"recorded_precision is null or recorded_precision in ({_quoted(PRECISIONS)})",
    )
    op.create_check_constraint(
        "ck_recordings_recorded_date",
        "recordings",
        "(recorded_at is null) = (recorded_precision is null)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_recordings_recorded_date", "recordings", type_="check")
    op.drop_constraint("ck_recordings_recorded_precision", "recordings", type_="check")
    op.execute("update recordings set recorded_at = coalesce(recorded_at, added_at)")
    op.alter_column("recordings", "recorded_at", nullable=False)
    op.drop_column("recordings", "recorded_precision")
    op.drop_column("recordings", "added_at")
