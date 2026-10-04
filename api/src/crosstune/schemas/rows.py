"""Client-editable fields per table. Ownership columns are never accepted from a client."""

from __future__ import annotations

import re
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING, Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    ValidationInfo,
    field_validator,
    model_validator,
)

from crosstune.vocabulary import (
    LIMITS,
    LOOP_COLOR_COUNT,
    MAX_MODES,
    PITCH_CENTS_MAX,
    PITCH_CENTS_MIN,
    SEARCHABLE_PROVIDERS,
    SPEED_PERCENT_MAX,
    SPEED_PERCENT_MIN,
    TUNING_LENGTH,
    AudioQuality,
    Instrument,
    Mode,
    NotationPageState,
    PlayFirst,
    Provider,
    RecordingOrigin,
    RecordingPrecision,
    RecordingSource,
    RecordingState,
    TimeSignature,
    TuneStatus,
)

if TYPE_CHECKING:
    from crosstune.vocabulary import TableName


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
# How far past the server's clock a pushed recorded date may be: a device clock that runs
# ahead, or a date picked in a zone east of UTC, still saves today.
RECORDED_AT_LEEWAY = timedelta(days=1)


def _distinct(values: list[str]) -> list[str]:
    if len(set(values)) != len(values):
        msg = "must not repeat a value"
        raise ValueError(msg)
    return values


def _no_other(values: list[str]) -> list[str]:
    if Provider.OTHER in values:
        msg = "other is not a searchable provider"
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
    tune_type: str | None = Field(default=None, max_length=TUNE["tune_type"])
    modes: list[Mode] = Field(default=[], max_length=MAX_MODES)
    composer: str | None = Field(default=None, max_length=TUNE["composer"])
    lyrics: str | None = Field(default=None, max_length=TUNE["lyrics"])
    key: str | None = Field(default=None, max_length=TUNE["key"])
    tunings: Tunings = Tunings()
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
    play_recording_id: uuid.UUID | None = None
    play_link_id: uuid.UUID | None = None

    @model_validator(mode="after")
    def _one_play_source(self) -> UserTuneData:
        if self.play_recording_id is not None and self.play_link_id is not None:
            msg = "a tune can pin a recording or a link, not both"
            raise ValueError(msg)
        return self


class _RecordingLinkFields(_Data):
    """Recording link fields. Only a push checks the url scheme, never a stored row."""

    tune_id: uuid.UUID
    url: str = Field(min_length=1, max_length=LINK["url"])
    provider: Provider
    provider_ref: str | None = Field(default=None, max_length=LINK["provider_ref"])
    title: str | None = Field(default=None, max_length=LINK["title"])
    # Only its length is checked: it holds whatever image URL the provider returned, which a
    # stricter type could refuse, failing the push of a link the resolver itself filled in.
    artwork_url: str | None = Field(default=None, max_length=LINK["artwork_url"])
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


class _RecordingFields(_Data):
    """Recording fields. Only a push checks the recorded date against the clock and its period."""

    tune_id: uuid.UUID | None = None
    label: str | None = Field(default=None, max_length=LIMITS["recordings"]["label"])
    source: RecordingSource
    origin: RecordingOrigin = Field(default=RecordingOrigin.OWN, validate_default=True)
    origin_url: str | None = Field(default=None, max_length=LIMITS["recordings"]["origin_url"])
    added_at: datetime
    # Declared before recorded_at so recorded_at's validators can read it.
    recorded_precision: RecordingPrecision | None = None
    # Validated even when left out, so a precision sent without a date is refused.
    recorded_at: datetime | None = Field(default=None, validate_default=True)
    position: int = 0
    trim_start_ms: int = Field(default=0, ge=0)
    trim_end_ms: int | None = Field(default=None, ge=0)
    speed_percent: int = Field(default=100, ge=SPEED_PERCENT_MIN, le=SPEED_PERCENT_MAX)
    pitch_cents: int = Field(default=0, ge=PITCH_CENTS_MIN, le=PITCH_CENTS_MAX)

    @field_validator("recorded_at")
    @classmethod
    def _date_matches_precision(
        cls, recorded_at: datetime | None, info: ValidationInfo
    ) -> datetime | None:
        # A precision that failed its own validation is absent here and already refused.
        if "recorded_precision" in info.data and (recorded_at is None) != (
            info.data["recorded_precision"] is None
        ):
            msg = "recorded_at is set exactly when recorded_precision is"
            raise ValueError(msg)
        return recorded_at


def _period_start(at: datetime, precision: str) -> datetime:
    """The UTC midnight that starts the year, month, or day holding `at`."""
    day = at.replace(hour=0, minute=0, second=0, microsecond=0)
    if precision == RecordingPrecision.YEAR:
        return day.replace(month=1, day=1)
    if precision == RecordingPrecision.MONTH:
        return day.replace(day=1)
    return day


class RecordingData(_RecordingFields):
    """Client-editable fields of a recording. The file columns are server-owned."""

    @field_validator("recorded_at")
    @classmethod
    def _plausible_date(cls, recorded_at: datetime | None, info: ValidationInfo) -> datetime | None:
        if recorded_at is None:
            return None
        utc = (recorded_at if recorded_at.tzinfo else recorded_at.replace(tzinfo=UTC)).astimezone(
            UTC
        )
        if utc > datetime.now(UTC) + RECORDED_AT_LEEWAY:
            msg = "recorded_at must not be in the future"
            raise ValueError(msg)
        # Every client formats a partial date in UTC, so one stored off its period's UTC
        # start would show the neighboring day, month, or year.
        precision = info.data.get("recorded_precision")
        if precision not in (None, RecordingPrecision.TIME) and utc != _period_start(
            utc, precision
        ):
            msg = "a partial recorded_at must be UTC midnight at the start of its period"
            raise ValueError(msg)
        return recorded_at


class NotationPageData(_Data):
    """Client-editable fields of a notation page. The file columns are server-owned."""

    tune_id: uuid.UUID
    position: int = 0
    width: int = Field(gt=0)
    height: int = Field(gt=0)


class _RecordingLoopFields(_Data):
    """Loop fields shared by what a client pushes and what the server returns."""

    recording_id: uuid.UUID
    label: str | None = Field(default=None, max_length=LIMITS["recording_loops"]["label"])
    start_ms: int = Field(ge=0)
    end_ms: int = Field(ge=0)
    color: int = Field(ge=0, le=LOOP_COLOR_COUNT - 1)


class RecordingLoopData(_RecordingLoopFields):
    """Client-editable fields of a practice loop. Positions are source-timeline milliseconds."""

    @model_validator(mode="after")
    def _end_after_start(self) -> RecordingLoopData:
        if self.end_ms <= self.start_ms:
            msg = "end_ms must be greater than start_ms"
            raise ValueError(msg)
        return self


class UserSettingsData(_Data):
    """Client-editable fields of a user's settings."""

    instruments: Annotated[list[Instrument], AfterValidator(_distinct)] = []
    # The default is validated too, so it is stored as a plain string like a sent value.
    audio_quality: AudioQuality = Field(default=AudioQuality.STANDARD, validate_default=True)
    play_first: PlayFirst = Field(default=PlayFirst.RECORDINGS, validate_default=True)
    search_providers: Annotated[
        list[Provider], AfterValidator(_distinct), AfterValidator(_no_other)
    ] = Field(default_factory=lambda: list(SEARCHABLE_PROVIDERS))


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
    # No default, so the contract promises the list on every row the client reads.
    modes: list[Mode] = Field(max_length=MAX_MODES)


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


class RecordingRow(_RecordingFields, _Row):
    """A stored recording, as push and pull return it. Storage keys stay on the server."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID
    state: RecordingState
    duration_ms: int | None
    playback_mime: str | None
    playback_bytes: int | None
    error: str | None
    source_duration_ms: int | None
    playback_start_ms: int | None
    playback_end_ms: int | None
    playback_rev: str | None
    peaks_rev: str | None


class NotationPageRow(NotationPageData, _Row):
    """A stored notation page, as push and pull return it. The storage key stays on the server."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID
    state: NotationPageState
    file_bytes: int | None


class RecordingLoopRow(_RecordingLoopFields, _Row):
    """A stored practice loop, as push and pull return it."""

    model_config = ConfigDict(extra="ignore")

    user_id: uuid.UUID


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
    "notation_pages": NotationPageData,
    "recording_loops": RecordingLoopData,
    "user_settings": UserSettingsData,
}

ROW_SCHEMAS: dict[TableName, type[BaseModel]] = {
    "tunes": TuneRow,
    "user_tunes": UserTuneRow,
    "lists": ListRow,
    "list_items": ListItemRow,
    "recording_links": RecordingLinkRow,
    "recordings": RecordingRow,
    "notation_pages": NotationPageRow,
    "recording_loops": RecordingLoopRow,
    "user_settings": UserSettingsRow,
}
