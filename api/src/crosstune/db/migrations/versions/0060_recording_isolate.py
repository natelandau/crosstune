"""recording isolate settings and mono flag

Revision ID: 0060
Revises: 0059
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None

CHECKS = {
    "ck_recordings_isolate_effect": "isolate_effect in ('solo', 'mute')",
    "ck_recordings_isolate_pan_start": "isolate_pan_start between -100 and 100",
    "ck_recordings_isolate_pan_end": "isolate_pan_end between -100 and 100",
    "ck_recordings_isolate_pan_order": "isolate_pan_start <= isolate_pan_end",
    "ck_recordings_isolate_low_hz": "isolate_low_hz between 40 and 16000",
    "ck_recordings_isolate_high_hz": "isolate_high_hz between 40 and 16000",
    "ck_recordings_isolate_hz_order": "isolate_low_hz <= isolate_high_hz",
}


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "recordings",
        sa.Column("isolate_effect", sa.String(4), nullable=False, server_default="solo"),
    )
    op.add_column(
        "recordings",
        sa.Column("isolate_pan_start", sa.SmallInteger, nullable=False, server_default="-100"),
    )
    op.add_column(
        "recordings",
        sa.Column("isolate_pan_end", sa.SmallInteger, nullable=False, server_default="100"),
    )
    op.add_column(
        "recordings",
        sa.Column("isolate_low_hz", sa.SmallInteger, nullable=False, server_default="40"),
    )
    op.add_column(
        "recordings",
        sa.Column("isolate_high_hz", sa.SmallInteger, nullable=False, server_default="16000"),
    )
    op.add_column("recordings", sa.Column("is_mono", sa.Boolean, nullable=True))
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, "recordings", condition)


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    for name in reversed(CHECKS):
        op.drop_constraint(name, "recordings", type_="check")
    op.drop_column("recordings", "is_mono")
    op.drop_column("recordings", "isolate_high_hz")
    op.drop_column("recordings", "isolate_low_hz")
    op.drop_column("recordings", "isolate_pan_end")
    op.drop_column("recordings", "isolate_pan_start")
    op.drop_column("recordings", "isolate_effect")
