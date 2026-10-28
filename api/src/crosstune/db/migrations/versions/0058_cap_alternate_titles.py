"""cap a tune's alternate titles at 50

Revision ID: 0058
Revises: 0057
"""

from __future__ import annotations

from alembic import op

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None

MAX_ALTERNATE_TITLES = 50


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    # Every pulled row is validated against the row schema, so one stored tune past the cap
    # would fail every pull of its owner. A fresh server_seq makes clients pull the trimmed row.
    op.execute(
        f"update tunes set alternate_titles = alternate_titles[1:{MAX_ALTERNATE_TITLES}], "
        "server_seq = nextval('sync_seq') "
        f"where cardinality(alternate_titles) > {MAX_ALTERNATE_TITLES}"
    )
    op.create_check_constraint(
        "ck_tunes_alternate_titles",
        "tunes",
        f"cardinality(alternate_titles) <= {MAX_ALTERNATE_TITLES}",
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_constraint("ck_tunes_alternate_titles", "tunes", type_="check")
