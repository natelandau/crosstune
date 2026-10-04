"""the import job kind

Revision ID: 0025
Revises: 0024
"""

from __future__ import annotations

from alembic import op

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None

OLD_KINDS = ("transcode", "trim", "peaks")
NEW_KINDS = (*OLD_KINDS, "import")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(NEW_KINDS)})")


def downgrade() -> None:
    # A pre-0025 runner has no import kind, so a queued import cannot survive. Its
    # recording fails the way an unreachable site fails it, so a client can retry it.
    op.execute(
        "update recordings set state = 'failed', error = 'Couldn''t reach Slippery-Hill', "
        "server_seq = nextval('sync_seq') "
        "where state = 'processing' "
        "and id in (select recording_id from jobs where kind = 'import')"
    )
    op.execute("delete from jobs where kind = 'import'")
    op.drop_constraint("ck_jobs_kind", "jobs", type_="check")
    op.create_check_constraint("ck_jobs_kind", "jobs", f"kind in ({_quoted(OLD_KINDS)})")
