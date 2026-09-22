"""Named, ordered lists of a user's songs."""

from __future__ import annotations

import uuid

from sqlalchemy import ForeignKey, Index, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from crosstune.db.base import Base, SyncColumns
from crosstune.vocabulary import LIMITS


class List(SyncColumns, Base):
    """A setlist or any other grouping."""

    __tablename__ = "lists"
    __table_args__ = (Index("ix_lists_user_id_server_seq", "user_id", "server_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(LIMITS["lists"]["name"]), nullable=False)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class ListItem(SyncColumns, Base):
    """References the user's record of a song, so a setlist carries that player's status and notes."""

    __tablename__ = "list_items"
    __table_args__ = (Index("ix_list_items_list_id_server_seq", "list_id", "server_seq"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    list_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("lists.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_song_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("user_songs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
