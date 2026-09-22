"""The vocabulary module is the only hand-edited source of validated values and limits."""

from datetime import UTC, datetime

from sqlalchemy import ARRAY, CheckConstraint, String

from crosstune import vocabulary
from crosstune.models import Recording, RecordingLink, Song, UserSettings, UserSong
from crosstune.models._checks import in_list
from crosstune.schemas.rows import DATA_SCHEMAS, SongData, UserSettingsData
from crosstune.sync.tables import TABLES

NOW = datetime(2026, 9, 22, tzinfo=UTC)

# Every check constraint that lists values, and the enum it must list.
CHECKS = {
    (Song, "ck_songs_mode"): ("mode", vocabulary.Mode, True),
    (Song, "ck_songs_time_signature"): ("time_signature", vocabulary.TimeSignature, True),
    (UserSong, "ck_user_songs_status"): ("status", vocabulary.SongStatus, False),
    (RecordingLink, "ck_recording_links_provider"): ("provider", vocabulary.Provider, False),
    (Recording, "ck_recordings_source"): ("source", vocabulary.RecordingSource, False),
    (Recording, "ck_recordings_state"): ("state", vocabulary.RecordingState, False),
    (UserSettings, "ck_user_settings_audio_quality"): (
        "audio_quality",
        vocabulary.AudioQuality,
        False,
    ),
}


def _constraint(model, name: str) -> CheckConstraint:
    return next(c for c in model.__table__.constraints if getattr(c, "name", None) == name)


def test_every_listed_check_constraint_matches_its_enum() -> None:
    for (model, name), (column, enum, nullable) in CHECKS.items():
        expected = in_list(column, tuple(enum), nullable=nullable)
        assert str(_constraint(model, name).sqltext) == expected, name


def test_every_limited_column_width_matches_the_table() -> None:
    models = {spec.name: spec.model for spec in TABLES.values()}
    for table, fields in vocabulary.LIMITS.items():
        for field, limit in fields.items():
            column_type = models[table].__table__.c[field].type
            if isinstance(column_type, ARRAY):
                column_type = column_type.item_type
            if isinstance(column_type, String) and column_type.length is not None:
                assert column_type.length == limit, f"{table}.{field}"


def _from_metadata(metadata) -> int | None:
    # A top-level Field puts MaxLen straight in the metadata; a Field inside Annotated
    # arrives as a FieldInfo whose own metadata holds the MaxLen.
    for meta in metadata:
        if getattr(meta, "max_length", None) is not None:
            return meta.max_length
        found = _from_metadata(getattr(meta, "metadata", ()))
        if found is not None:
            return found
    return None


def _max_length(info) -> int | None:
    found = _from_metadata(info.metadata)
    if found is not None:
        return found
    # A list of limited strings carries the limit on the item annotation.
    for arg in getattr(info.annotation, "__args__", ()):
        found = _from_metadata(getattr(arg, "__metadata__", ()))
        if found is not None:
            return found
    return None


def test_every_schema_max_length_matches_the_table() -> None:
    for table, fields in vocabulary.LIMITS.items():
        schema = DATA_SCHEMAS[table]
        for field, limit in fields.items():
            assert _max_length(schema.model_fields[field]) == limit, f"{table}.{field}"


def test_validated_values_are_stored_as_plain_strings() -> None:
    song = SongData(title="Sally Ann", mode="major", created_at=NOW)
    assert type(song.model_dump()["mode"]) is str
    settings = UserSettingsData(instruments=["violin"], created_at=NOW)
    assert type(settings.model_dump()["audio_quality"]) is str
    assert type(settings.model_dump()["instruments"][0]) is str
