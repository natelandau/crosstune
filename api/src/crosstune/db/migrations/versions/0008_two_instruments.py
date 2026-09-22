"""keep violin and banjo as the only instruments

Revision ID: 0008
Revises: 0007
"""

from __future__ import annotations

from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

RETIRED = ("guitar", "mandolin", "ukulele", "bass", "dulcimer", "accordion", "other")


def upgrade() -> None:
    # A settings row holding a retired instrument would fail validation on its next pull,
    # so strip the values here. A fresh server_seq is what makes clients pull the row.
    quoted = ", ".join(f"'{value}'" for value in RETIRED)
    op.execute(
        "update user_settings set "
        f"instruments = array(select v from unnest(instruments) as v where v not in ({quoted})), "
        "updated_at = now(), server_seq = nextval('sync_seq') "
        f"where instruments && array[{quoted}]::varchar[]"
    )


def downgrade() -> None:
    # The stripped instruments are gone; the old list only becomes valid again.
    pass
