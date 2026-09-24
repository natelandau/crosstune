"""Client-editable fields per table. Ownership columns are never accepted from a client."""

from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING, Annotated, Any

from pydantic import (
    AfterValidator,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

from crosstune.vocabulary import (
    LIMITS,
    TUNING_LENGTH,
    AudioQuality,
    Instrument,
    Mode,
    Provider,
    RecordingSource,
    RecordingState,
    TimeSignature,
    TuneStatus,
)

if TYPE_CHECKING:
    from crosstune.schemas.common import TableName


TUNE = LIMITS["tunes"]
USER_TUNE = LIMITS["user_tunes"]
LINK = LIMITS["recording_links"]
# An RFC 3986 scheme, which is also what a browser's URL parser reads as one.
URL_SCHEME = re.compile(r"([A-Za-z][A-Za-z0-9+.-]*):")
# What a browser's URL parser drops before it reads a scheme: C0 controls and spaces at
# either end, and tabs and newlines anywhere.
URL_EDGE = "".join(chr(code) for code in range(0x21))
URL_IGNORED = str.maketrans("", "", "\t\n\r")
WEB_SCHEMES = frozenset({"http", "https"})


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


def _unset(value: object) -> bool:
    return value is None


def _empty(entry: InstrumentTuning | None) -> bool:
    return entry is None or not entry.model_dump()


# Unset fields and empty entries are left out of every dump, so a stored map, a pushed map,
# and the wire share one compact shape: {} when empty, {"guitar": {"capo": 3}} with no nulls.
class InstrumentTuning(BaseModel):
    """One instrument's tuning on a tune."""

    model_config = ConfigDict(extra="forbid")

    tuning: str | None = Field(default=None, max_length=TUNING_LENGTH, exclude_if=_unset)


class FrettedTuning(InstrumentTuning):
    """A fretted instrument's tuning, with the fret its capo sits at."""

    capo: int | None = Field(default=None, ge=1, le=12, exclude_if=_unset)


class Tunings(BaseModel):
    """A tune's tunings, one optional entry per instrument."""

    model_config = ConfigDict(extra="forbid")

    violin: InstrumentTuning | None = Field(default=None, exclude_if=_empty)
    five_string_banjo: FrettedTuning | None = Field(default=None, exclude_if=_empty)
    tenor_banjo: FrettedTuning | None = Field(default=None, exclude_if=_empty)
    guitar: FrettedTuning | None = Field(default=None, exclude_if=_empty)
    mandolin: FrettedTuning | None = Field(default=None, exclude_if=_empty)
    bouzouki: FrettedTuning | None = Field(default=None, exclude_if=_empty)
    mountain_dulcimer: FrettedTuning | None = Field(default=None, exclude_if=_empty)


class TuneData(_Data):
    """Client-editable fields of a tune."""

    title: str = Field(min_length=1, max_length=TUNE["title"])
    alternate_titles: list[Annotated[str, Field(max_length=TUNE["alternate_titles"])]] = []
    genre: str | None = Field(default=None, max_length=TUNE["genre"])
    feel: str | None = Field(default=None, max_length=TUNE["feel"])
    lyrics: str | None = Field(default=None, max_length=TUNE["lyrics"])
    key: str | None = Field(default=None, max_length=TUNE["key"])
    mode: Mode | None = None
    tunings: Tunings = Tunings()
    # Legacy shape, accepted until every client sends tunings. Push folds them into tunings.
    violin_tuning: str | None = Field(default=None, max_length=TUNING_LENGTH)
    banjo_tuning: str | None = Field(default=None, max_length=TUNING_LENGTH)
    part_structure: str | None = Field(default=None, max_length=TUNE["part_structure"])
    time_signature: TimeSignature | None = None
    is_crooked: bool = False


class UserTuneData(_Data):
    """Client-editable fields of a user's relationship to a tune."""

    tune_id: uuid.UUID
    status: TuneStatus
    learned_from: str | None = Field(default=None, max_length=USER_TUNE["learned_from"])
    learned_on: date | None = None
    notes: str | None = Field(default=None, max_length=USER_TUNE["notes"])
    archived_at: datetime | None = None


class _RecordingLinkFields(_Data):
    """Recording link fields. Only a push checks the url scheme, never a stored row."""

    tune_id: uuid.UUID
    url: str = Field(min_length=1, max_length=LINK["url"])
    provider: Provider
    provider_ref: str | None = Field(default=None, max_length=LINK["provider_ref"])
    title: str | None = Field(default=None, max_length=LINK["title"])
    artwork_url: str | None = Field(default=None, max_length=LINK["artwork_url"])
    label: str | None = Field(default=None, max_length=LINK["label"])
    position: int = 0


class RecordingLinkData(_RecordingLinkFields):
    """Client-editable fields of a recording link."""

    @field_validator("url")
    @classmethod
    def _web_scheme(cls, url: str) -> str:
        # Mirrors the client's outboundUrl, never stricter: a pasted link it accepted offline
        # that failed here would be dropped as invalid. A scheme-less paste is read as https.
        match = URL_SCHEME.match(url.strip(URL_EDGE).translate(URL_IGNORED))
        if match and match.group(1).lower() not in WEB_SCHEMES:
            msg = "must be an http or https URL"
            raise ValueError(msg)
        return url


class ListData(_Data):
    """Client-editable fields of a list."""

    name: str = Field(min_length=1, max_length=LIMITS["lists"]["name"])
    position: int = 0


class ListItemData(_Data):
    """Client-editable fields of a list item."""

    list_id: uuid.UUID
    user_tune_id: uuid.UUID
    position: int = 0


class RecordingData(_Data):
    """Client-editable fields of a recording. The file columns are server-owned."""

    tune_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=LIMITS["recordings"]["label"])
    source: RecordingSource
    recorded_at: datetime
    position: int = 0


def _renamed_instruments(values: Any) -> Any:
    # A client that predates five_string_banjo still sends banjo.
    if not isinstance(values, list):
        return values
    renamed = ["five_string_banjo" if v == "banjo" else v for v in values]
    if "banjo" in values and "five_string_banjo" in values:
        # Both spellings name one instrument, so they merge rather than read as a repeat.
        first = renamed.index("five_string_banjo")
        return [v for i, v in enumerate(renamed) if v != "five_string_banjo" or i == first]
    return renamed


class UserSettingsData(_Data):
    """Client-editable fields of a user's settings."""

    instruments: Annotated[
        list[Instrument], BeforeValidator(_renamed_instruments), AfterValidator(_distinct)
    ] = []
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


class TuneRow(TuneData, _Row):
    """A stored tune, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    owner_user_id: uuid.UUID | None

    @model_validator(mode="before")
    @classmethod
    def _legacy_tunings(cls, row: Any) -> Any:
        # A client that predates the map still reads its two instruments from these fields.
        if isinstance(row, dict) and isinstance(row.get("tunings"), dict):
            tunings = row["tunings"]
            row = {
                **row,
                "violin_tuning": (tunings.get("violin") or {}).get("tuning"),
                "banjo_tuning": (tunings.get("five_string_banjo") or {}).get("tuning"),
            }
        return row


class UserTuneRow(UserTuneData, _Row):
    """A stored user tune, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID


class RecordingLinkRow(_RecordingLinkFields, _Row):
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
    "tunes": TuneData,
    "user_tunes": UserTuneData,
    "lists": ListData,
    "list_items": ListItemData,
    "recording_links": RecordingLinkData,
    "recordings": RecordingData,
    "user_settings": UserSettingsData,
}

ROW_SCHEMAS: dict[TableName, type[BaseModel]] = {
    "tunes": TuneRow,
    "user_tunes": UserTuneRow,
    "lists": ListRow,
    "list_items": ListItemRow,
    "recording_links": RecordingLinkRow,
    "recordings": RecordingRow,
    "user_settings": UserSettingsRow,
}
