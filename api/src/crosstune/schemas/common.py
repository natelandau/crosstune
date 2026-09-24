"""Push and pull envelope types."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, model_validator

from crosstune.schemas.legacy import current_change
from crosstune.schemas.rows import (
    ListItemRow,
    ListRow,
    RecordingLinkRow,
    RecordingRow,
    TuneRow,
    UserSettingsRow,
    UserTuneRow,
)

TableName = Literal[
    "tunes",
    "user_tunes",
    "lists",
    "list_items",
    "recording_links",
    "recordings",
    "user_settings",
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

    @model_validator(mode="before")
    @classmethod
    def _read_song_names(cls, value: Any) -> Any:
        return current_change(value)


class _ChangeResult(BaseModel):
    """What happened to one change. row carries the current server row for stale and applied."""

    id: uuid.UUID
    status: Status
    reason: str | None = None


class TuneChangeResult(_ChangeResult):
    """The outcome of one change to a tune."""

    table: Literal["tunes"]
    row: TuneRow | None = None


class UserTuneChangeResult(_ChangeResult):
    """The outcome of one change to a user tune."""

    table: Literal["user_tunes"]
    row: UserTuneRow | None = None


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


class RecordingChangeResult(_ChangeResult):
    """The outcome of one change to a recording."""

    table: Literal["recordings"]
    row: RecordingRow | None = None


class UserSettingsChangeResult(_ChangeResult):
    """The outcome of one change to a user's settings."""

    table: Literal["user_settings"]
    row: UserSettingsRow | None = None


ChangeResult = Annotated[
    TuneChangeResult
    | UserTuneChangeResult
    | ListChangeResult
    | ListItemChangeResult
    | RecordingLinkChangeResult
    | RecordingChangeResult
    | UserSettingsChangeResult,
    Field(discriminator="table"),
]

CHANGE_RESULTS: dict[TableName, type[_ChangeResult]] = {
    "tunes": TuneChangeResult,
    "user_tunes": UserTuneChangeResult,
    "lists": ListChangeResult,
    "list_items": ListItemChangeResult,
    "recording_links": RecordingLinkChangeResult,
    "recordings": RecordingChangeResult,
    "user_settings": UserSettingsChangeResult,
}


class TunePullRow(BaseModel):
    """A tune row in a pull page."""

    table: Literal["tunes"]
    row: TuneRow


class UserTunePullRow(BaseModel):
    """A user tune row in a pull page."""

    table: Literal["user_tunes"]
    row: UserTuneRow


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


class RecordingPullRow(BaseModel):
    """A recording row in a pull page."""

    table: Literal["recordings"]
    row: RecordingRow


class UserSettingsPullRow(BaseModel):
    """A settings row in a pull page."""

    table: Literal["user_settings"]
    row: UserSettingsRow


PullRow = Annotated[
    TunePullRow
    | UserTunePullRow
    | ListPullRow
    | ListItemPullRow
    | RecordingLinkPullRow
    | RecordingPullRow
    | UserSettingsPullRow,
    Field(discriminator="table"),
]

PULL_ROWS: dict[TableName, type[BaseModel]] = {
    "tunes": TunePullRow,
    "user_tunes": UserTunePullRow,
    "lists": ListPullRow,
    "list_items": ListItemPullRow,
    "recording_links": RecordingLinkPullRow,
    "recordings": RecordingPullRow,
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
