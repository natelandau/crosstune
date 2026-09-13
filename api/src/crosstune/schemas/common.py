"""Push and pull envelope types."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field

from crosstune.schemas.rows import (
    ListItemRow,
    ListRow,
    RecordingLinkRow,
    SongRow,
    UserSettingsRow,
    UserSongRow,
)

TableName = Literal[
    "songs", "user_songs", "lists", "list_items", "recording_links", "user_settings"
]
Op = Literal["upsert", "delete"]
Status = Literal["applied", "stale", "invalid"]

MAX_CHANGES_PER_PUSH = 500


class Change(BaseModel):
    """One client change. updated_at is the client's clock and decides last-write-wins."""

    table: TableName
    op: Op
    id: uuid.UUID
    updated_at: datetime
    data: dict[str, Any] | None = None


class _ChangeResult(BaseModel):
    """What happened to one change. row carries the current server row for stale and applied."""

    id: uuid.UUID
    status: Status
    reason: str | None = None


class SongChangeResult(_ChangeResult):
    """The outcome of one change to a song."""

    table: Literal["songs"]
    row: SongRow | None = None


class UserSongChangeResult(_ChangeResult):
    """The outcome of one change to a user song."""

    table: Literal["user_songs"]
    row: UserSongRow | None = None


class ListChangeResult(_ChangeResult):
    """The outcome of one change to a list."""

    table: Literal["lists"]
    row: ListRow | None = None


class ListItemChangeResult(_ChangeResult):
    """The outcome of one change to a list item."""

    table: Literal["list_items"]
    row: ListItemRow | None = None


class RecordingLinkChangeResult(_ChangeResult):
    """The outcome of one change to a recording link."""

    table: Literal["recording_links"]
    row: RecordingLinkRow | None = None


class UserSettingsChangeResult(_ChangeResult):
    """The outcome of one change to a user's settings."""

    table: Literal["user_settings"]
    row: UserSettingsRow | None = None


ChangeResult = Annotated[
    SongChangeResult
    | UserSongChangeResult
    | ListChangeResult
    | ListItemChangeResult
    | RecordingLinkChangeResult
    | UserSettingsChangeResult,
    Field(discriminator="table"),
]

CHANGE_RESULTS: dict[TableName, type[_ChangeResult]] = {
    "songs": SongChangeResult,
    "user_songs": UserSongChangeResult,
    "lists": ListChangeResult,
    "list_items": ListItemChangeResult,
    "recording_links": RecordingLinkChangeResult,
    "user_settings": UserSettingsChangeResult,
}


class SongPullRow(BaseModel):
    """A song row in a pull page."""

    table: Literal["songs"]
    row: SongRow


class UserSongPullRow(BaseModel):
    """A user song row in a pull page."""

    table: Literal["user_songs"]
    row: UserSongRow


class ListPullRow(BaseModel):
    """A list row in a pull page."""

    table: Literal["lists"]
    row: ListRow


class ListItemPullRow(BaseModel):
    """A list item row in a pull page."""

    table: Literal["list_items"]
    row: ListItemRow


class RecordingLinkPullRow(BaseModel):
    """A recording link row in a pull page."""

    table: Literal["recording_links"]
    row: RecordingLinkRow


class UserSettingsPullRow(BaseModel):
    """A settings row in a pull page."""

    table: Literal["user_settings"]
    row: UserSettingsRow


PullRow = Annotated[
    SongPullRow
    | UserSongPullRow
    | ListPullRow
    | ListItemPullRow
    | RecordingLinkPullRow
    | UserSettingsPullRow,
    Field(discriminator="table"),
]

PULL_ROWS: dict[TableName, type[BaseModel]] = {
    "songs": SongPullRow,
    "user_songs": UserSongPullRow,
    "lists": ListPullRow,
    "list_items": ListItemPullRow,
    "recording_links": RecordingLinkPullRow,
    "user_settings": UserSettingsPullRow,
}


class PushRequest(BaseModel):
    """A batch of client changes to apply."""

    changes: list[Change] = Field(max_length=MAX_CHANGES_PER_PUSH)


class PushResponse(BaseModel):
    """One result per change, same order as the request."""

    results: list[ChangeResult]


class PullResponse(BaseModel):
    """A page of rows changed since the given cursor."""

    rows: list[PullRow]
    next_since: int
    has_more: bool
