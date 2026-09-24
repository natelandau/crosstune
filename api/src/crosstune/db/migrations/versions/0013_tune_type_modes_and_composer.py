"""tune type, a mode per part, composer, and 3/2 time

Revision ID: 0013
Revises: 0012
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

MODES = ("major", "minor", "mixolydian", "dorian", "modal", "other")
OLD_TIME_SIGNATURES = ("4/4", "2/4", "2/2", "3/4", "6/8", "9/8", "12/8", "other")
NEW_TIME_SIGNATURES = ("4/4", "2/4", "2/2", "3/4", "3/2", "6/8", "9/8", "12/8", "other")
MAX_MODES = 4


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def _replace_time_signature_constraint(values: tuple[str, ...]) -> None:
    op.drop_constraint("ck_tunes_time_signature", "tunes", type_="check")
    op.create_check_constraint(
        "ck_tunes_time_signature",
        "tunes",
        f"time_signature is null or time_signature in ({_quoted(values)})",
    )


def upgrade() -> None:
    op.add_column("tunes", sa.Column("tune_type", sa.String(100), nullable=True))
    op.add_column(
        "tunes",
        sa.Column("modes", ARRAY(sa.String(20)), nullable=False, server_default="{}"),
    )
    op.add_column("tunes", sa.Column("composer", sa.String(200), nullable=True))
    # The old columns stay until every client writes the new ones; they are copied, not moved.
    op.execute("update tunes set tune_type = feel")
    op.execute("update tunes set modes = array[mode] where mode is not null")
    op.create_check_constraint(
        "ck_tunes_modes",
        "tunes",
        f"cardinality(modes) <= {MAX_MODES} and modes <@ array[{_quoted(MODES)}]::varchar[]",
    )
    _replace_time_signature_constraint(NEW_TIME_SIGNATURES)


def downgrade() -> None:
    # A fresh server_seq is what makes clients pull the changed row. updated_at stays, so
    # an offline edit stamped before the migration still wins last-write-wins.
    op.execute(
        "update tunes set time_signature = 'other', server_seq = nextval('sync_seq') "
        "where time_signature = '3/2'"
    )
    _replace_time_signature_constraint(OLD_TIME_SIGNATURES)
    op.drop_constraint("ck_tunes_modes", "tunes", type_="check")
    op.drop_column("tunes", "composer")
    op.drop_column("tunes", "modes")
    op.drop_column("tunes", "tune_type")
