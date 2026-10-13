"""the key each upload slot signs, backfilled with the key earlier slots signed

Revision ID: 0043
Revises: 0042
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column("upload_slots", sa.Column("object_key", sa.String(512), nullable=True))
    # A slot issued before the column signed the recording's upload key or the scan's served key.
    op.execute(
        """
        update upload_slots
        set object_key = case
            when recording_id is not null then user_id::text || '/' || recording_id::text || '/upload'
            else user_id::text || '/scans/' || scan_id::text || '/scan.jpg'
        end
        """
    )
    op.alter_column("upload_slots", "object_key", nullable=False)


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("upload_slots", "object_key")
