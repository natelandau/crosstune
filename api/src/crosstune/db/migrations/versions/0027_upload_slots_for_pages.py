"""upload_slots_for_pages

Revision ID: 0027
Revises: 0026
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "upload_slots",
        sa.Column("id", postgresql.UUID(as_uuid=True), server_default=sa.text("gen_random_uuid()")),
    )
    op.execute("UPDATE upload_slots SET id = gen_random_uuid()")
    op.alter_column("upload_slots", "id", nullable=False, server_default=None)
    op.drop_constraint("upload_slots_pkey", "upload_slots", type_="primary")
    op.create_primary_key("upload_slots_pkey", "upload_slots", ["id"])
    op.alter_column("upload_slots", "recording_id", nullable=True)
    op.create_unique_constraint("uq_upload_slots_recording_id", "upload_slots", ["recording_id"])
    op.add_column(
        "upload_slots",
        sa.Column(
            "notation_page_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("notation_pages.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    op.create_unique_constraint(
        "uq_upload_slots_notation_page_id", "upload_slots", ["notation_page_id"]
    )
    op.create_check_constraint(
        "ck_upload_slots_one_owner",
        "upload_slots",
        "num_nonnulls(recording_id, notation_page_id) = 1",
    )


def downgrade() -> None:
    op.execute("DELETE FROM upload_slots WHERE recording_id IS NULL")
    op.drop_constraint("ck_upload_slots_one_owner", "upload_slots", type_="check")
    op.drop_constraint("uq_upload_slots_notation_page_id", "upload_slots", type_="unique")
    op.drop_column("upload_slots", "notation_page_id")
    op.drop_constraint("uq_upload_slots_recording_id", "upload_slots", type_="unique")
    op.drop_constraint("upload_slots_pkey", "upload_slots", type_="primary")
    op.alter_column("upload_slots", "recording_id", nullable=False)
    op.create_primary_key("upload_slots_pkey", "upload_slots", ["recording_id"])
    op.drop_column("upload_slots", "id")
