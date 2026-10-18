"""recording notes, players, and place

Revision ID: 0052
Revises: 0051
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0052"
down_revision = "0051"
branch_labels = None
depends_on = None

CHECKS = {
    "ck_recordings_place_coordinates": "(place_lat is null) = (place_lon is null)",
    "ck_recordings_place_name": "place_name is null or place_lat is not null",
    "ck_recordings_place_accuracy": (
        "place_accuracy_m is null or (place_lat is not null and place_accuracy_m >= 0)"
    ),
    "ck_recordings_place_range": (
        "place_lat is null or "
        "(place_lat between -90 and 90 and place_lon between -180 and 180)"
    ),
}


def upgrade() -> None:
    op.add_column("recordings", sa.Column("notes", sa.Text(), nullable=True))
    op.add_column("recordings", sa.Column("players", sa.String(200), nullable=True))
    op.add_column("recordings", sa.Column("place_lat", sa.Double(), nullable=True))
    op.add_column("recordings", sa.Column("place_lon", sa.Double(), nullable=True))
    op.add_column("recordings", sa.Column("place_name", sa.String(200), nullable=True))
    op.add_column("recordings", sa.Column("place_accuracy_m", sa.Integer(), nullable=True))
    for name, condition in CHECKS.items():
        op.create_check_constraint(name, "recordings", condition)


def downgrade() -> None:
    for name in reversed(CHECKS):
        op.drop_constraint(name, "recordings", type_="check")
    for column in ("place_accuracy_m", "place_name", "place_lon", "place_lat", "players", "notes"):
        op.drop_column("recordings", column)
