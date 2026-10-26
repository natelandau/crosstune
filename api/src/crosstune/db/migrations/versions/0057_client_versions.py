"""rename client_version_sightings to client_versions

Revision ID: 0057
Revises: 0056
"""

from __future__ import annotations

from alembic import op

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def _rename(old: str, new: str) -> None:
    op.execute("set local lock_timeout = '10s'")
    op.rename_table(old, new)
    # Renaming the primary key constraint renames its index too.
    op.execute(f"alter table {new} rename constraint {old}_pkey to {new}_pkey")
    op.execute(f"alter table {new} rename constraint {old}_user_id_fkey to {new}_user_id_fkey")


def upgrade() -> None:
    _rename("client_version_sightings", "client_versions")


def downgrade() -> None:
    _rename("client_versions", "client_version_sightings")
