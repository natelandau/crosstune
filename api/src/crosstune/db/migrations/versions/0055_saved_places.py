"""saved places and the recording link to them

Revision ID: 0055
Revises: 0054
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None

# The values are literals, not imports, so the migration keeps meaning what it meant when it ran.
ORIGINS = ("device", "file", "picked")


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_table(
        "places",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("lat", sa.Double(), nullable=False),
        sa.Column("lon", sa.Double(), nullable=False),
        sa.Column("address", sa.String(200), nullable=True),
        sa.Column("apple_place_id", sa.String(100), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger(),
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.CheckConstraint(
            "lat between -90 and 90 and lon between -180 and 180", name="ck_places_range"
        ),
    )
    op.create_index("ix_places_user_id_server_seq", "places", ["user_id", "server_seq"])

    op.add_column(
        "recordings",
        sa.Column(
            "place_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("places.id", name="recordings_place_id_fkey", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_recordings_place_id", "recordings", ["place_id"])
    op.add_column("recordings", sa.Column("place_origin", sa.String(10), nullable=True))

    # A fresh server_seq makes clients pull the inferred origin; updated_at stays the row's.
    op.execute(
        """
        update recordings
        set place_origin = case
                when place_accuracy_m is not null then 'device'
                when place_name is not null then 'picked'
                when source = 'upload' then 'file'
                else 'picked'
            end,
            server_seq = nextval('sync_seq')
        where place_lat is not null
        """
    )
    quoted = ", ".join(f"'{origin}'" for origin in ORIGINS)
    op.create_check_constraint(
        "ck_recordings_place_origin",
        "recordings",
        f"place_origin is null or place_origin in ({quoted})",
    )
    op.create_check_constraint(
        "ck_recordings_place_origin_coordinates",
        "recordings",
        "(place_origin is null) = (place_lat is null)",
    )


def downgrade() -> None:
    op.drop_constraint("ck_recordings_place_origin_coordinates", "recordings", type_="check")
    op.drop_constraint("ck_recordings_place_origin", "recordings", type_="check")
    op.drop_column("recordings", "place_origin")
    op.drop_index("ix_recordings_place_id", table_name="recordings")
    op.drop_column("recordings", "place_id")
    op.drop_index("ix_places_user_id_server_seq", table_name="places")
    op.drop_table("places")
