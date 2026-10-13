"""paid grants on entitlements, backfilled from each user's active paid grants

Revision ID: 0042
Revises: 0041
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column(
        "entitlements",
        sa.Column(
            "paid_grants",
            postgresql.JSONB(),
            nullable=False,
            server_default=sa.text("'[]'"),
        ),
    )
    # Each store's active grant that lasts longest, as the resolver picks it; a fresh
    # server_seq makes clients pull it, and updated_at stays the row's.
    op.execute(
        """
        update entitlements e
        set paid_grants = p.grants, server_seq = nextval('sync_seq')
        from (
            select user_id, jsonb_agg(
                jsonb_build_object(
                    'source', source, 'expires_at', expires_at, 'auto_renews', auto_renews
                ) order by source
            ) as grants
            from (
                select distinct on (user_id, source) user_id, source, expires_at, auto_renews
                from grants
                where kind = 'premium' and source in ('apple', 'stripe')
                    and (expires_at is null or expires_at > now())
                order by user_id, source, expires_at desc nulls first
            ) longest
            group by user_id
        ) p
        where p.user_id = e.user_id
        """
    )


def downgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.drop_column("entitlements", "paid_grants")
