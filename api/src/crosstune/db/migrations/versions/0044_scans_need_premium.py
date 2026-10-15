"""drop the free plan's scan quota and round every plan's quota to decimal units

Revision ID: 0044
Revises: 0043
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None

FREE_SCAN_QUOTA_BYTES = 52_428_800
# Each stored quota before and after: a trial, Premium, and Premium with the storage add-on.
QUOTAS = {
    104_857_600: 100_000_000,
    5_368_709_120: 3_000_000_000,
    5_368_709_120 + 53_687_091_200: 3_000_000_000 + 50_000_000_000,
}


def _resize(sizes: dict[int, int]) -> None:
    # A fresh server_seq makes clients pull the new size, and updated_at stays the row's.
    cases = " ".join(f"when {old} then {new}" for old, new in sizes.items())
    op.execute(
        f"""
        update entitlements
        set premium_quota_bytes = case premium_quota_bytes {cases} end,
            server_seq = nextval('sync_seq')
        where premium_quota_bytes in ({", ".join(str(old) for old in sizes)})
        """
    )


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "free_quota_bytes")
    _resize(QUOTAS)


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "entitlements",
        sa.Column(
            "free_quota_bytes",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text(str(FREE_SCAN_QUOTA_BYTES)),
        ),
    )
    # The default only fills existing rows; 0043's column has none.
    op.alter_column("entitlements", "free_quota_bytes", server_default=None)
    _resize({new: old for old, new in QUOTAS.items()})
