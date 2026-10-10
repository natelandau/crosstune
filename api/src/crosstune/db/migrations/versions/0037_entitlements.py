"""entitlements, grants and pending comps, with a trial for every existing user

Revision ID: 0037
Revises: 0036
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None

KINDS = ("premium", "storage_addon")
SOURCES = ("trial", "apple", "stripe", "comp")
ENVIRONMENTS = ("production", "sandbox")
# Binary units, matching the file caps. Hard-coded so the migration never moves with settings.
TRIAL_QUOTA_BYTES = 104_857_600
FREE_QUOTA_BYTES = 52_428_800


def _in_list(column: str, values: tuple[str, ...]) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    return f"{column} in ({quoted})"


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.add_column("users", sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "grants",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("source", sa.String(20), nullable=False),
        sa.Column("environment", sa.String(20), nullable=False, server_default="production"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_renews", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column("granted_by", sa.String(100), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(_in_list("kind", KINDS), name="ck_grants_kind"),
        sa.CheckConstraint(_in_list("source", SOURCES), name="ck_grants_source"),
        sa.CheckConstraint(_in_list("environment", ENVIRONMENTS), name="ck_grants_environment"),
    )
    op.create_index("ix_grants_user_id", "grants", ["user_id"])
    op.create_index(
        "ux_grants_user_kind_source_server",
        "grants",
        ["user_id", "kind", "source"],
        unique=True,
        postgresql_where=sa.text("source in ('trial', 'comp')"),
    )
    op.create_table(
        "pending_comps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("storage_addon", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("granted_by", sa.String(100), nullable=True),
        sa.Column("reason", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint("email = lower(email)", name="ck_pending_comps_email_lower"),
    )
    op.create_table(
        "entitlements",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("premium_source", sa.String(20), nullable=True),
        sa.Column("premium_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("auto_renews", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("trial_ends_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("premium_quota_bytes", sa.BigInteger, nullable=False),
        sa.Column("free_quota_bytes", sa.BigInteger, nullable=False),
        sa.Column("recording_notice_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("trial_reminder_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "server_seq",
            sa.BigInteger,
            nullable=False,
            server_default=sa.text("nextval('sync_seq')"),
        ),
        sa.UniqueConstraint("user_id", name="uq_entitlements_user_id"),
        sa.CheckConstraint(
            f"premium_source is null or {_in_list('premium_source', SOURCES)}",
            name="ck_entitlements_premium_source",
        ),
    )
    # Every existing user starts a 30-day trial now, so no tester loses recordings before a comp.
    op.execute(
        """
        insert into grants (id, user_id, kind, source, environment, expires_at, auto_renews,
                            created_at, updated_at)
        select gen_random_uuid(), id, 'premium', 'trial', 'production',
               now() + interval '30 days', false, now(), now()
        from users
        """
    )
    op.execute(
        f"""
        insert into entitlements (id, user_id, premium_source, premium_expires_at, auto_renews,
                                  trial_ends_at, premium_quota_bytes, free_quota_bytes,
                                  created_at, updated_at)
        select gen_random_uuid(), user_id, 'trial', expires_at, false, expires_at,
               {TRIAL_QUOTA_BYTES}, {FREE_QUOTA_BYTES}, now(), now()
        from grants
        where kind = 'premium' and source = 'trial'
        """
    )


def downgrade() -> None:
    op.drop_table("entitlements")
    op.drop_table("pending_comps")
    op.drop_table("grants")
    op.drop_column("users", "last_synced_at")
