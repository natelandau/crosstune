"""upload slot confirm token, the hash of the token that confirms an upload without sign-in

Revision ID: 0066
Revises: 0065
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "upload_slots", sa.Column("confirm_token_hash", sa.String(length=64), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("upload_slots", "confirm_token_hash")
