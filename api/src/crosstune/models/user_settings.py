"""Account-level preferences. One row per user, created and edited by the client."""

from __future__ import annotations

import uuid

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import ARRAY, UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list
from crosstune.models.tune import TUNE
from crosstune.vocabulary import SEARCHABLE_PROVIDERS, AudioQuality, PlayFirst, TuneStatus


class UserSettings(SyncColumns, Base):
    """The instruments a user plays, how they record, and how a new tune starts.

    Clients derive the id from the user so every device agrees.
    """

    __tablename__ = "user_settings"
    # One row per user, so the unique index alone serves pulls scoped by user and server_seq.
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_user_settings_user_id"),
        CheckConstraint(
            in_list("audio_quality", tuple(AudioQuality), nullable=False),
            name="ck_user_settings_audio_quality",
        ),
        CheckConstraint(
            in_list("play_first", tuple(PlayFirst), nullable=False),
            name="ck_user_settings_play_first",
        ),
        CheckConstraint(
            in_list("new_tune_status", tuple(TuneStatus), nullable=False),
            name="ck_user_settings_new_tune_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    instruments: Mapped[list[str]] = mapped_column(ARRAY(String(20)), nullable=False, default=list)
    audio_quality: Mapped[str] = mapped_column(
        String(20), nullable=False, default=AudioQuality.STANDARD.value
    )
    search_providers: Mapped[list[str]] = mapped_column(
        ARRAY(String(20)), nullable=False, default=lambda: list(SEARCHABLE_PROVIDERS)
    )
    play_first: Mapped[str] = mapped_column(
        String(20), nullable=False, default=PlayFirst.RECORDINGS.value
    )
    new_tune_genre: Mapped[str | None] = mapped_column(String(TUNE["genre"]), nullable=True)
    new_tune_status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=TuneStatus.WANT_TO_LEARN.value
    )
