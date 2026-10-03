"""user_settings: the music services a user searches

Revision ID: 0021
Revises: 0020
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

EVERY_SERVICE = "{apple_music,tidal,internet_archive,youtube,spotify,bandcamp,soundcloud}"


def upgrade() -> None:
    op.add_column(
        "user_settings",
        sa.Column(
            "search_providers",
            postgresql.ARRAY(sa.String(20)),
            nullable=False,
            server_default=EVERY_SERVICE,
        ),
    )


def downgrade() -> None:
    op.drop_column("user_settings", "search_providers")
