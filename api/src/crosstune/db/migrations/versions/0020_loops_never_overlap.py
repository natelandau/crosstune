"""loops on one recording never overlap

Revision ID: 0020
Revises: 0019
"""

from __future__ import annotations

from alembic import op

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

MIN_LOOP_MS = 500

# crosstune.db.locks.advisory_lock_key in SQL: the uuid's last 8 bytes as a signed bigint,
# so the migration waits on the same per-user lock a sync push holds.
LOCK_KEY_SQL = "('x' || right(replace({column}::text, '-', ''), 16))::bit(64)::bigint"


def upgrade() -> None:
    op.execute("set local lock_timeout = '10s'")
    op.execute("create extension if not exists btree_gist")
    # Users are locked in key order so this never deadlocks against a push holding one of them;
    # the table lock then keeps any other writer out until the constraint is in place.
    op.execute(
        f"""
        do $$
        declare
            lock_key bigint;
        begin
            for lock_key in
                select distinct {LOCK_KEY_SQL.format(column="a.user_id")}
                from recording_loops a
                join recording_loops b
                    on b.recording_id = a.recording_id
                    and b.id <> a.id
                    and b.deleted_at is null
                    and b.start_ms < a.end_ms
                    and a.start_ms < b.end_ms
                where a.deleted_at is null
                order by 1
            loop
                perform pg_advisory_xact_lock(lock_key);
            end loop;
        end
        $$
        """
    )
    op.execute("lock table recording_loops in share row exclusive mode")
    # Each live loop's start is cut to the end of the loops kept before it. A loop left under
    # MIN_LOOP_MS is tombstoned with its span intact and must not move the kept end, which a
    # window function cannot express. A fresh server_seq is what makes clients pull the row.
    op.execute(
        f"""
        do $$
        declare
            loop_row record;
            current_recording uuid;
            kept_end integer;
        begin
            for loop_row in
                select id, recording_id, start_ms, end_ms
                from recording_loops
                where deleted_at is null
                order by recording_id, start_ms, end_ms, id
            loop
                if current_recording is distinct from loop_row.recording_id then
                    current_recording := loop_row.recording_id;
                    kept_end := null;
                end if;
                if kept_end is null or loop_row.start_ms >= kept_end then
                    kept_end := loop_row.end_ms;
                elsif loop_row.end_ms - kept_end >= {MIN_LOOP_MS} then
                    update recording_loops
                    set start_ms = kept_end, updated_at = now(), server_seq = nextval('sync_seq')
                    where id = loop_row.id;
                    kept_end := loop_row.end_ms;
                else
                    update recording_loops
                    set deleted_at = now(), updated_at = now(), server_seq = nextval('sync_seq')
                    where id = loop_row.id;
                end if;
            end loop;
        end
        $$
        """
    )
    # Raw DDL because op.create_exclude_constraint cannot take an expression element.
    op.execute(
        "alter table recording_loops add constraint ex_recording_loops_no_overlap "
        "exclude using gist (recording_id with =, int4range(start_ms, end_ms) with &&) "
        "where (deleted_at is null)"
    )


def downgrade() -> None:
    """Drop the constraint only; loops cut or tombstoned on upgrade stay that way."""
    op.drop_constraint("ex_recording_loops_no_overlap", "recording_loops")
