"""the highest audio quality

Revision ID: 0029
Revises: 0028
"""

from __future__ import annotations

from alembic import op

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

OLD_QUALITIES = ("low", "standard", "high")
NEW_QUALITIES = (*OLD_QUALITIES, "highest")


def _quoted(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.drop_constraint("ck_user_settings_audio_quality", "user_settings", type_="check")
    op.create_check_constraint(
        "ck_user_settings_audio_quality",
        "user_settings",
        f"audio_quality in ({_quoted(NEW_QUALITIES)})",
    )


def downgrade() -> None:
    # Bumping server_seq makes clients pull the mapped value instead of keeping 'highest'.
    op.execute(
        "update user_settings set audio_quality = 'high', server_seq = nextval('sync_seq') "
        "where audio_quality = 'highest'"
    )
    op.drop_constraint("ck_user_settings_audio_quality", "user_settings", type_="check")
    op.create_check_constraint(
        "ck_user_settings_audio_quality",
        "user_settings",
        f"audio_quality in ({_quoted(OLD_QUALITIES)})",
    )
