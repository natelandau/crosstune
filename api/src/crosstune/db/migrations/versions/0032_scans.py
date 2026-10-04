"""rename notation_pages to scans

Revision ID: 0032
Revises: 0031
"""

from __future__ import annotations

from alembic import op

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None

TABLE = ("notation_pages", "scans")
SLOT_COLUMN = ("notation_page_id", "scan_id")
TABLE_CONSTRAINTS = (
    ("notation_pages_pkey", "scans_pkey"),
    ("notation_pages_user_id_fkey", "scans_user_id_fkey"),
    ("notation_pages_tune_id_fkey", "scans_tune_id_fkey"),
    ("ck_notation_pages_width", "ck_scans_width"),
    ("ck_notation_pages_height", "ck_scans_height"),
    ("ck_notation_pages_state", "ck_scans_state"),
)
INDEXES = (
    ("ix_notation_pages_tune_id", "ix_scans_tune_id"),
    ("ix_notation_pages_user_id_server_seq", "ix_scans_user_id_server_seq"),
)
SLOT_CONSTRAINTS = (
    ("upload_slots_notation_page_id_fkey", "upload_slots_scan_id_fkey"),
    ("uq_upload_slots_notation_page_id", "uq_upload_slots_scan_id"),
)


def _rename(*, to_scans: bool) -> None:
    """Rename in place, so every row and upload slot keeps its data."""

    def ordered(pair: tuple[str, str]) -> tuple[str, str]:
        return pair if to_scans else (pair[1], pair[0])

    old_table, new_table = ordered(TABLE)
    op.rename_table(old_table, new_table)
    for old, new in map(ordered, TABLE_CONSTRAINTS):
        op.execute(f"ALTER TABLE {new_table} RENAME CONSTRAINT {old} TO {new}")
    # Postgres 18 and later name each NOT NULL constraint after its table; older ones have none.
    op.execute(
        f"""
        DO $$
        DECLARE c record;
        BEGIN
            FOR c IN SELECT conname FROM pg_constraint
                WHERE conrelid = '{new_table}'::regclass AND contype = 'n'
                AND starts_with(conname, '{old_table}_')
            LOOP
                EXECUTE format(
                    'ALTER TABLE {new_table} RENAME CONSTRAINT %I TO %I',
                    c.conname,
                    '{new_table}' || substr(c.conname, {len(old_table) + 1})
                );
            END LOOP;
        END $$
        """
    )
    for old, new in map(ordered, INDEXES):
        op.execute(f"ALTER INDEX {old} RENAME TO {new}")
    old_column, new_column = ordered(SLOT_COLUMN)
    # Postgres rewrites ck_upload_slots_one_owner to name the renamed column.
    op.alter_column("upload_slots", old_column, new_column_name=new_column)
    for old, new in map(ordered, SLOT_CONSTRAINTS):
        op.execute(f"ALTER TABLE upload_slots RENAME CONSTRAINT {old} TO {new}")


def upgrade() -> None:
    _rename(to_scans=True)


def downgrade() -> None:
    _rename(to_scans=False)
