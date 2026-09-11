"""What the sync engine knows about each table."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from sqlalchemy import inspect

from crosstune.models import List, ListItem, RecordingLink, Song, UserSong
from crosstune.schemas.rows import (
    DATA_SCHEMAS,
    ROW_SCHEMAS,
    ListData,
    ListItemData,
    ListItemRow,
    ListRow,
    RecordingLinkData,
    RecordingLinkRow,
    SongData,
    SongRow,
    UserSongData,
    UserSongRow,
)

if TYPE_CHECKING:
    from pydantic import BaseModel

    from crosstune.db.base import Base
    from crosstune.schemas.common import TableName


@dataclass(frozen=True)
class TableSpec:
    """One synced table.

    owner_column names the column that must equal the calling user.
    parents lists (foreign key column, parent table) pairs whose target must be owned by the caller.
    """

    name: TableName
    model: type[Base]
    data_schema: type
    row_schema: type[BaseModel]
    owner_column: str
    parents: tuple[tuple[str, TableName], ...]


# Parents before children, so a batch that creates a song and its links applies in one pass.
TABLE_ORDER: tuple[TableName, ...] = (
    "songs",
    "user_songs",
    "lists",
    "list_items",
    "recording_links",
)

TABLES: dict[TableName, TableSpec] = {
    "songs": TableSpec("songs", Song, SongData, SongRow, "owner_user_id", ()),
    "user_songs": TableSpec(
        "user_songs", UserSong, UserSongData, UserSongRow, "user_id", (("song_id", "songs"),)
    ),
    "lists": TableSpec("lists", List, ListData, ListRow, "user_id", ()),
    "list_items": TableSpec(
        "list_items",
        ListItem,
        ListItemData,
        ListItemRow,
        "",  # no owner column; ownership is proven through both parents
        (("list_id", "lists"), ("user_song_id", "user_songs")),
    ),
    "recording_links": TableSpec(
        "recording_links",
        RecordingLink,
        RecordingLinkData,
        RecordingLinkRow,
        "added_by_user_id",
        (("song_id", "songs"),),
    ),
}

assert set(TABLES) == set(DATA_SCHEMAS) == set(ROW_SCHEMAS)  # noqa: S101


def row_to_dict(obj: Base) -> dict[str, Any]:
    """Every mapped column of an ORM row, ready for jsonable_encoder."""
    return {attr.key: getattr(obj, attr.key) for attr in inspect(obj).mapper.column_attrs}
