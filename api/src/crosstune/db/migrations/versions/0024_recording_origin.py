"""recording origin and origin_url, and the import source

Revision ID: 0024
Revises: 0023
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None

OLD_SOURCES = ("microphone", "upload")
NEW_SOURCES = (*OLD_SOURCES, "import")
ORIGINS = ("own", "slippery_hill")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.add_column(
        "recordings", sa.Column("origin", sa.String(20), nullable=False, server_default="own")
    )
    op.add_column("recordings", sa.Column("origin_url", sa.String(2048), nullable=True))
    op.create_check_constraint(
        "ck_recordings_origin", "recordings", f"origin in ({_quoted(ORIGINS)})"
    )
    op.create_check_constraint(
        "ck_recordings_origin_url", "recordings", "(origin = 'own') = (origin_url is null)"
    )
    op.drop_constraint("ck_recordings_source", "recordings", type_="check")
    op.create_check_constraint(
        "ck_recordings_source", "recordings", f"source in ({_quoted(NEW_SOURCES)})"
    )
    op.create_check_constraint(
        "ck_recordings_import_origin", "recordings", "(source = 'import') = (origin <> 'own')"
    )


def downgrade() -> None:
    # An import has no pre-0024 shape, and deleting it would destroy the user's audio.
    imports = op.get_bind().execute(
        sa.text("select 1 from recordings where source = 'import' limit 1")
    )
    if imports.first() is not None:
        msg = "recordings with source 'import' exist"
        raise RuntimeError(msg)

    op.drop_constraint("ck_recordings_import_origin", "recordings", type_="check")
    op.drop_constraint("ck_recordings_source", "recordings", type_="check")
    op.create_check_constraint(
        "ck_recordings_source", "recordings", f"source in ({_quoted(OLD_SOURCES)})"
    )
    op.drop_constraint("ck_recordings_origin_url", "recordings", type_="check")
    op.drop_constraint("ck_recordings_origin", "recordings", type_="check")
    op.drop_column("recordings", "origin_url")
    op.drop_column("recordings", "origin")
