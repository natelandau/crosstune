"""a tunings map on tunes, and banjo renamed five_string_banjo

Revision ID: 0012
Revises: 0011
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

# Instruments a pre-0012 settings row cannot hold, other than the renamed banjo.
ADDED = ("tenor_banjo", "guitar", "mandolin", "bouzouki", "mountain_dulcimer")


def upgrade() -> None:
    op.add_column(
        "tunes",
        sa.Column("tunings", JSONB(), nullable=False, server_default=sa.text("'{}'::jsonb")),
    )
    op.create_check_constraint("ck_tunes_tunings", "tunes", "jsonb_typeof(tunings) = 'object'")
    op.execute(
        "update tunes set tunings = jsonb_strip_nulls(jsonb_build_object("
        "'violin', case when violin_tuning is not null "
        "then jsonb_build_object('tuning', violin_tuning) end, "
        "'five_string_banjo', case when banjo_tuning is not null "
        "then jsonb_build_object('tuning', banjo_tuning) end))"
    )
    op.drop_column("tunes", "violin_tuning")
    op.drop_column("tunes", "banjo_tuning")
    # A fresh server_seq makes clients pull the renamed value. updated_at stays, so an
    # offline settings edit stamped before the migration still wins last-write-wins.
    op.execute(
        "update user_settings set "
        "instruments = array_replace(instruments, 'banjo', 'five_string_banjo'), "
        "server_seq = nextval('sync_seq') "
        "where 'banjo' = any(instruments)"
    )


def downgrade() -> None:
    op.add_column("tunes", sa.Column("violin_tuning", sa.String(100), nullable=True))
    op.add_column("tunes", sa.Column("banjo_tuning", sa.String(100), nullable=True))
    # Every other instrument's entry, and every capo, is lost here.
    op.execute(
        "update tunes set violin_tuning = tunings #>> '{violin,tuning}', "
        "banjo_tuning = tunings #>> '{five_string_banjo,tuning}'"
    )
    op.drop_constraint("ck_tunes_tunings", "tunes", type_="check")
    op.drop_column("tunes", "tunings")
    quoted = ", ".join(f"'{value}'" for value in ADDED)
    op.execute(
        "update user_settings set instruments = array_replace("
        f"array(select v from unnest(instruments) as v where v not in ({quoted})), "
        "'five_string_banjo', 'banjo'), "
        "server_seq = nextval('sync_seq') "
        f"where instruments && array[{quoted}, 'five_string_banjo']::varchar[]"
    )
