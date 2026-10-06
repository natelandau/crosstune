"""index the tombstones the purge sweep reads on every runner pass

Revision ID: 0034
Revises: 0033
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None

TOMBSTONES = sa.text("deleted_at is not null")


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_index("ix_recordings_tombstones", "recordings", ["id"], postgresql_where=TOMBSTONES)
    op.create_index("ix_scans_tombstones", "scans", ["id"], postgresql_where=TOMBSTONES)


def downgrade() -> None:
    op.drop_index("ix_scans_tombstones", table_name="scans")
    op.drop_index("ix_recordings_tombstones", table_name="recordings")
