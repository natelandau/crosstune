"""lyrics text in place of the has_lyrics flag

Revision ID: 0007
Revises: 0006
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("songs", sa.Column("lyrics", sa.Text, nullable=True))
    op.drop_column("songs", "has_lyrics")


def downgrade() -> None:
    op.add_column("songs", sa.Column("has_lyrics", sa.Boolean, nullable=True))
    op.execute("update songs set has_lyrics = true where lyrics is not null and lyrics <> ''")
    op.drop_column("songs", "lyrics")
