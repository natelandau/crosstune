"""Client-editable fields per table. Ownership columns are never accepted from a client."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Annotated

from pydantic import AfterValidator, BaseModel, ConfigDict, Field

from crosstune.vocabulary import (
    LIMITS,
    AudioQuality,
    Instrument,
    Mode,
    Provider,
    RecordingSource,
    RecordingState,
    SongStatus,
    TimeSignature,
)

if TYPE_CHECKING:
    from crosstune.schemas.common import TableName


SONG = LIMITS["songs"]
USER_SONG = LIMITS["user_songs"]
LINK = LIMITS["recording_links"]


def _distinct(values: list[str]) -> list[str]:
    if len(set(values)) != len(values):
        msg = "must not repeat a value"
        raise ValueError(msg)
    return values


# A validated enum is stored as its plain string, so rows and pushes carry what the
# database holds rather than enum members.
class _Data(BaseModel):
    model_config = ConfigDict(extra="forbid", use_enum_values=True)

    created_at: datetime


class SongData(_Data):
    """Client-editable fields of a song."""

    title: str = Field(min_length=1, max_length=SONG["title"])
    alternate_titles: list[Annotated[str, Field(max_length=SONG["alternate_titles"])]] = []
    genre: str | None = Field(default=None, max_length=SONG["genre"])
    feel: str | None = Field(default=None, max_length=SONG["feel"])
    lyrics: str | None = Field(default=None, max_length=SONG["lyrics"])
    key: str | None = Field(default=None, max_length=SONG["key"])
    mode: Mode | None = None
    violin_tuning: str | None = Field(default=None, max_length=SONG["violin_tuning"])
    banjo_tuning: str | None = Field(default=None, max_length=SONG["banjo_tuning"])
    part_structure: str | None = Field(default=None, max_length=SONG["part_structure"])
    time_signature: TimeSignature | None = None
    is_crooked: bool = False


class UserSongData(_Data):
    """Client-editable fields of a user's relationship to a song."""

    song_id: uuid.UUID
    status: SongStatus
    learned_from: str | None = Field(default=None, max_length=USER_SONG["learned_from"])
    learned_on: date | None = None
    notes: str | None = Field(default=None, max_length=USER_SONG["notes"])
    archived_at: datetime | None = None


class RecordingLinkData(_Data):
    """Client-editable fields of a recording link."""

    song_id: uuid.UUID
    url: str = Field(min_length=1, max_length=LINK["url"])
    provider: Provider
    provider_ref: str | None = Field(default=None, max_length=LINK["provider_ref"])
    title: str | None = Field(default=None, max_length=LINK["title"])
    artwork_url: str | None = Field(default=None, max_length=LINK["artwork_url"])
    label: str | None = Field(default=None, max_length=LINK["label"])
    position: int = 0


class ListData(_Data):
    """Client-editable fields of a list."""

    name: str = Field(min_length=1, max_length=LIMITS["lists"]["name"])
    position: int = 0


class ListItemData(_Data):
    """Client-editable fields of a list item."""

    list_id: uuid.UUID
    user_song_id: uuid.UUID
    position: int = 0


class RecordingData(_Data):
    """Client-editable fields of a recording. The file columns are server-owned."""

    song_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=LIMITS["recordings"]["label"])
    source: RecordingSource
    recorded_at: datetime
    position: int = 0


class UserSettingsData(_Data):
    """Client-editable fields of a user's settings."""

    instruments: Annotated[list[Instrument], AfterValidator(_distinct)] = []
    # The default is validated too, so it is stored as a plain string like a sent value.
    audio_quality: AudioQuality = Field(default=AudioQuality.STANDARD, validate_default=True)


class _Row(BaseModel):
    """Bookkeeping columns every stored row carries back out.

    Output rows are built from ORM rows rather than client input, so unknown columns are
    dropped instead of rejected.
    """

    model_config = ConfigDict(extra="ignore", use_enum_values=True)

    id: uuid.UUID
    updated_at: datetime
    deleted_at: datetime | None
    server_seq: int


class SongRow(SongData, _Row):
    """A stored song, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    owner_user_id: uuid.UUID | None


class UserSongRow(UserSongData, _Row):
    """A stored user song, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID


class RecordingLinkRow(RecordingLinkData, _Row):
    """A stored recording link, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    added_by_user_id: uuid.UUID


class ListRow(ListData, _Row):
    """A stored list, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID


class ListItemRow(ListItemData, _Row):
    """A stored list item, as push and pull return it. Ownership comes from its list."""

    model_config = ConfigDict(extra="ignore")


class RecordingRow(RecordingData, _Row):
    """A stored recording, as push and pull return it. Storage keys stay on the server."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID
    state: RecordingState
    duration_ms: int | None
    playback_mime: str | None
    playback_bytes: int | None
    error: str | None


class UserSettingsRow(UserSettingsData, _Row):
    """A stored settings row, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID


DATA_SCHEMAS: dict[TableName, type[_Data]] = {
    "songs": SongData,
    "user_songs": UserSongData,
    "lists": ListData,
    "list_items": ListItemData,
    "recording_links": RecordingLinkData,
    "recordings": RecordingData,
    "user_settings": UserSettingsData,
}

ROW_SCHEMAS: dict[TableName, type[BaseModel]] = {
    "songs": SongRow,
    "user_songs": UserSongRow,
    "lists": ListRow,
    "list_items": ListItemRow,
    "recording_links": RecordingLinkRow,
    "recordings": RecordingRow,
    "user_settings": UserSettingsRow,
}
