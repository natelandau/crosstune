"""A page of written music attached to a tune, stored as an image object in R2."""

from __future__ import annotations

import uuid

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.models._checks import in_list
from crosstune.vocabulary import NotationPageState


class NotationPage(SyncColumns, Base):
    """One page image. The client owns the layout columns; the server owns the file columns."""

    __tablename__ = "notation_pages"
    __table_args__ = (
        CheckConstraint("width > 0", name="ck_notation_pages_width"),
        CheckConstraint("height > 0", name="ck_notation_pages_height"),
        CheckConstraint(
            in_list("state", tuple(NotationPageState), nullable=False),
            name="ck_notation_pages_state",
        ),
        Index("ix_notation_pages_user_id_server_seq", "user_id", "server_seq"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    tune_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tunes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(
        String(20), nullable=False, default=NotationPageState.PENDING_UPLOAD.value
    )
    file_key: Mapped[str | None] = mapped_column(Text, nullable=True)
    file_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
