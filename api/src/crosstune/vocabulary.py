"""Every value the server validates and every field length it enforces, in one place.

The models build their check constraints and column widths from this module, the row
schemas validate with it, and the OpenAPI document publishes it, so the web client's
copies are generated rather than written. A change here needs a migration for the
check constraint or column it alters, and `just contract` afterwards.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Final


class Instrument(StrEnum):
    """An instrument with a per-tune tuning. The order is the order the client lists them in."""

    VIOLIN = "violin"
    FIVE_STRING_BANJO = "five_string_banjo"
    TENOR_BANJO = "tenor_banjo"
    GUITAR = "guitar"
    MANDOLIN = "mandolin"
    BOUZOUKI = "bouzouki"
    MOUNTAIN_DULCIMER = "mountain_dulcimer"


FRETTED: Final[frozenset[Instrument]] = frozenset(Instrument) - {Instrument.VIOLIN}
"""Instruments that take a capo."""

TUNING_LENGTH: Final = 100
"""Maximum length of one instrument's tuning inside a tune's tunings."""


class TuneStatus(StrEnum):
    """Where a player stands with a tune."""

    KNOWN = "known"
    LEARNING = "learning"
    WANT_TO_LEARN = "want_to_learn"


class Mode(StrEnum):
    """A tune's mode."""

    MAJOR = "major"
    MINOR = "minor"
    MIXOLYDIAN = "mixolydian"
    DORIAN = "dorian"
    MODAL = "modal"
    OTHER = "other"


class TimeSignature(StrEnum):
    """A tune's time signature."""

    FOUR_FOUR = "4/4"
    TWO_FOUR = "2/4"
    TWO_TWO = "2/2"
    THREE_FOUR = "3/4"
    THREE_TWO = "3/2"
    SIX_EIGHT = "6/8"
    NINE_EIGHT = "9/8"
    TWELVE_EIGHT = "12/8"
    OTHER = "other"


# One mode per part, for a tune whose parts change mode. Four covers an ABCD tune.
MAX_MODES: Final[int] = 4


class Provider(StrEnum):
    """Where a recording link points."""

    YOUTUBE = "youtube"
    SPOTIFY = "spotify"
    APPLE_MUSIC = "apple_music"
    BANDCAMP = "bandcamp"
    SOUNDCLOUD = "soundcloud"
    TIDAL = "tidal"
    INTERNET_ARCHIVE = "internet_archive"
    OTHER = "other"


class AudioQuality(StrEnum):
    """A capture bitrate preset."""

    LOW = "low"
    STANDARD = "standard"
    HIGH = "high"


class RecordingSource(StrEnum):
    """How a recording's audio arrived."""

    MICROPHONE = "microphone"
    UPLOAD = "upload"


class RecordingState(StrEnum):
    """Where a recording's file is in the upload and transcode pipeline."""

    PENDING_UPLOAD = "pending_upload"
    UPLOADED = "uploaded"
    PROCESSING = "processing"
    READY = "ready"
    FAILED = "failed"


# Maximum lengths, by table then field. A column with a width takes it from here, the
# row schema publishes it, and the client stops input at it.
LIMITS: Final[dict[str, dict[str, int]]] = {
    "tunes": {
        "title": 200,
        "alternate_titles": 200,
        "key": 10,
        "genre": 100,
        "tune_type": 100,
        "part_structure": 100,
        "composer": 200,
        "lyrics": 20_000,
    },
    "user_tunes": {
        "learned_from": 200,
        "notes": 20_000,
    },
    "lists": {
        "name": 200,
    },
    "recording_links": {
        "url": 2048,
        "provider_ref": 200,
        "title": 300,
        "artwork_url": 2048,
        "label": 200,
    },
    "recordings": {
        "label": 200,
    },
}
