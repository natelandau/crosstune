"""activity history tables and the first status row per user tune

Revision ID: 0031
Revises: 0030
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None

STATUSES = ("known", "learning", "want_to_learn")
PLAY_CONTEXTS = ("row", "list", "dock", "recording_screen")

# crosstune.db.locks.advisory_lock_key in SQL: the uuid's last 8 bytes as a signed bigint,
# so the migration waits on the same per-user lock a sync push holds.
LOCK_KEY_SQL = "('x' || right(replace({column}::text, '-', ''), 16))::bit(64)::bigint"


def _in_list(column: str, values: tuple[str, ...], *, nullable: bool) -> str:
    quoted = ", ".join(f"'{value}'" for value in values)
    clause = f"{column} in ({quoted})"
    return f"{column} is null or {clause}" if nullable else clause


def _uuid_column(name: str, *, nullable: bool) -> sa.Column:
    return sa.Column(name, postgresql.UUID(as_uuid=True), nullable=nullable)


def _user_id_column() -> sa.Column:
    return sa.Column(
        "user_id",
        postgresql.UUID(as_uuid=True),
        sa.ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )


def _server_seq() -> sa.Column:
    return sa.Column(
        "server_seq", sa.BigInteger, nullable=False, server_default=sa.text("nextval('sync_seq')")
    )


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.create_table(
        "status_changes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _user_id_column(),
        sa.Column(
            "user_tune_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("user_tunes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("from_status", sa.String(20), nullable=True),
        sa.Column("to_status", sa.String(20), nullable=False),
        sa.Column("changed_at", sa.DateTime(timezone=True), nullable=False),
        _server_seq(),
        sa.CheckConstraint(
            _in_list("from_status", STATUSES, nullable=True), name="ck_status_changes_from_status"
        ),
        sa.CheckConstraint(
            _in_list("to_status", STATUSES, nullable=False), name="ck_status_changes_to_status"
        ),
    )
    op.create_index(
        "ix_status_changes_user_id_server_seq", "status_changes", ["user_id", "server_seq"]
    )
    op.create_index(
        "ix_status_changes_user_id_changed_at", "status_changes", ["user_id", "changed_at"]
    )

    op.create_table(
        "play_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _user_id_column(),
        _uuid_column("tune_id", nullable=True),
        _uuid_column("recording_id", nullable=True),
        _uuid_column("link_id", nullable=True),
        sa.Column("context", sa.String(20), nullable=False),
        _uuid_column("list_id", nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("listened_ms", sa.Integer, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        _server_seq(),
        sa.CheckConstraint(
            "(recording_id is null) <> (link_id is null)", name="ck_play_events_one_source"
        ),
        sa.CheckConstraint(
            _in_list("context", PLAY_CONTEXTS, nullable=False), name="ck_play_events_context"
        ),
        sa.CheckConstraint("listened_ms >= 0", name="ck_play_events_listened_ms"),
    )
    op.create_index("ix_play_events_user_id_server_seq", "play_events", ["user_id", "server_seq"])
    op.create_index("ix_play_events_user_id_started_at", "play_events", ["user_id", "started_at"])

    op.create_table(
        "practice_sessions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        _user_id_column(),
        _uuid_column("recording_id", nullable=False),
        _uuid_column("tune_id", nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_ms", sa.Integer, nullable=False),
        sa.Column(
            "loop_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
        sa.Column("speed_percent", sa.SmallInteger, nullable=False),
        sa.Column("pitch_cents", sa.SmallInteger, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        _server_seq(),
        sa.CheckConstraint("duration_ms >= 0", name="ck_practice_sessions_duration_ms"),
    )
    op.create_index(
        "ix_practice_sessions_user_id_server_seq", "practice_sessions", ["user_id", "server_seq"]
    )
    op.create_index(
        "ix_practice_sessions_user_id_started_at", "practice_sessions", ["user_id", "started_at"]
    )

    # Users are locked in key order so this never deadlocks against a push holding one of them,
    # and each user's server_seq numbers commit in order relative to their pushes.
    op.execute(
        f"""
        do $$
        declare
            lock_key bigint;
        begin
            for lock_key in
                select distinct {LOCK_KEY_SQL.format(column="user_id")}
                from user_tunes
                where deleted_at is null
                order by 1
            loop
                perform pg_advisory_xact_lock(lock_key);
            end loop;
        end
        $$
        """
    )
    # The sort sits in a subquery so nextval runs in row order, not before the sort.
    op.execute(
        """
        insert into status_changes
            (id, user_id, user_tune_id, from_status, to_status, changed_at, server_seq)
        select gen_random_uuid(), user_id, id, null, status, created_at, nextval('sync_seq')
        from (
            select user_id, id, status, created_at
            from user_tunes
            where deleted_at is null
            order by user_id, created_at
        ) as live
        """
    )


def downgrade() -> None:
    op.drop_table("practice_sessions")
    op.drop_table("play_events")
    op.drop_table("status_changes")
