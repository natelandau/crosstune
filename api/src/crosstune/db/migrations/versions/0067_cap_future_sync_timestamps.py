"""cap sync timestamps stored past server time, so a fast device clock stops winning conflicts

Revision ID: 0067
Revises: 0066
"""

from __future__ import annotations

from alembic import op

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None

# The tables a client pushes rows to, each stamped with the client's clock.
_TABLES = (
    "tunes",
    "user_tunes",
    "lists",
    "list_items",
    "recording_links",
    "places",
    "recordings",
    "scans",
    "recording_loops",
    "user_settings",
)

# Matches the push ceiling, so a row a correct clock wrote stays as it is.
_CEILING = "now() + interval '5 minutes'"
_BUMP = "server_seq = nextval('sync_seq')"


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    for table in _TABLES:
        # The new server_seq sends the capped stamp to every device on its next pull.
        op.execute(
            f"update {table} set "  # noqa: S608 -- table names are the constants above
            f"updated_at = least(updated_at, {_CEILING}), "
            # Not least(): it skips nulls, which would tombstone every live row it touched.
            f"deleted_at = case when deleted_at > {_CEILING} then {_CEILING} "
            "else deleted_at end, "
            f"{_BUMP} "
            f"where updated_at > {_CEILING} or deleted_at > {_CEILING}"
        )


def downgrade() -> None:
    """Leave the capped stamps: the clock each row first carried is not kept."""
