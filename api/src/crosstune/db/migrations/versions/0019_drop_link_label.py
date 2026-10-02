"""drop the recording link label

Revision ID: 0019
Revises: 0018
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("recording_links", "label")


def downgrade() -> None:
    op.add_column("recording_links", sa.Column("label", sa.String(200), nullable=True))
