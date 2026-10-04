"""The vocabulary module is the only hand-edited source of validated values and limits."""

from datetime import UTC, datetime

from sqlalchemy import ARRAY, CheckConstraint, String

from crosstune import vocabulary
from crosstune.models import (
    Job,
    Recording,
    RecordingLink,
    RecordingLoop,
    Tune,
    UserSettings,
    UserTune,
)
from crosstune.models._checks import between, in_list, within_list
from crosstune.schemas.rows import DATA_SCHEMAS, RecordingRow, TuneData, UserSettingsData
from crosstune.sync.tables import TABLES

NOW = datetime(2026, 9, 22, tzinfo=UTC)

# Every check constraint that lists values, and the enum it must list.
CHECKS = {
    (Tune, "ck_tunes_time_signature"): ("time_signature", vocabulary.TimeSignature, True),
    (UserTune, "ck_user_tunes_status"): ("status", vocabulary.TuneStatus, False),
    (RecordingLink, "ck_recording_links_provider"): ("provider", vocabulary.Provider, False),
    (Recording, "ck_recordings_source"): ("source", vocabulary.RecordingSource, False),
    (Recording, "ck_recordings_state"): ("state", vocabulary.RecordingState, False),
    (Recording, "ck_recordings_origin"): ("origin", vocabulary.RecordingOrigin, False),
    (Recording, "ck_recordings_recorded_precision"): (
        "recorded_precision",
        vocabulary.RecordingPrecision,
        True,
    ),
    (UserSettings, "ck_user_settings_audio_quality"): (
        "audio_quality",
        vocabulary.AudioQuality,
        False,
    ),
    (UserSettings, "ck_user_settings_play_first"): ("play_first", vocabulary.PlayFirst, False),
    (Job, "ck_jobs_kind"): ("kind", vocabulary.JobKind, False),
}

# Every check constraint that restricts a column to an inclusive numeric range.
RANGE_CHECKS = {
    (Recording, "ck_recordings_speed_percent"): (
        "speed_percent",
        vocabulary.SPEED_PERCENT_MIN,
        vocabulary.SPEED_PERCENT_MAX,
    ),
    (Recording, "ck_recordings_pitch_cents"): (
        "pitch_cents",
        vocabulary.PITCH_CENTS_MIN,
        vocabulary.PITCH_CENTS_MAX,
    ),
    (RecordingLoop, "ck_recording_loops_color"): (
        "color",
        0,
        vocabulary.LOOP_COLOR_COUNT - 1,
    ),
}


def _constraint(model, name: str) -> CheckConstraint:
    return next(c for c in model.__table__.constraints if getattr(c, "name", None) == name)


def test_every_listed_check_constraint_matches_its_enum() -> None:
    for (model, name), (column, enum, nullable) in CHECKS.items():
        expected = in_list(column, tuple(enum), nullable=nullable)
        assert str(_constraint(model, name).sqltext) == expected, name


def test_every_listed_check_constraint_matches_its_range() -> None:
    for (model, name), (column, low, high) in RANGE_CHECKS.items():
        assert str(_constraint(model, name).sqltext) == between(column, low, high), name


def test_trim_start_ms_check_constraint_matches_its_sql() -> None:
    assert str(_constraint(Recording, "ck_recordings_trim_start_ms").sqltext) == (
        "trim_start_ms >= 0"
    )


def test_loop_start_and_length_check_constraints_match_their_sql() -> None:
    assert str(_constraint(RecordingLoop, "ck_recording_loops_start_ms").sqltext) == (
        "start_ms >= 0"
    )
    assert str(_constraint(RecordingLoop, "ck_recording_loops_min_length").sqltext) == (
        f"deleted_at IS NOT NULL OR end_ms - start_ms >= {vocabulary.MIN_LOOP_MS}"
    )


def test_recorded_date_check_constraint_pairs_the_date_and_its_precision() -> None:
    assert str(_constraint(Recording, "ck_recordings_recorded_date").sqltext) == (
        "(recorded_at is null) = (recorded_precision is null)"
    )


def test_a_recorded_date_is_as_precise_as_a_year_month_day_or_time() -> None:
    assert [p.value for p in vocabulary.RecordingPrecision] == ["year", "month", "day", "time"]


def test_modes_check_lists_every_mode_and_the_cap() -> None:
    expected = within_list("modes", tuple(vocabulary.Mode), vocabulary.MAX_MODES)
    assert str(_constraint(Tune, "ck_tunes_modes").sqltext) == expected


def test_three_two_is_a_time_signature() -> None:
    assert vocabulary.TimeSignature("3/2") is vocabulary.TimeSignature.THREE_TWO


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
    tune = TuneData(title="Sally Ann", modes=["major"], created_at=NOW)
    assert type(tune.model_dump()["modes"][0]) is str
    settings = UserSettingsData(instruments=["violin"], created_at=NOW)
    assert type(settings.model_dump()["audio_quality"]) is str
    assert type(settings.model_dump()["instruments"][0]) is str


def test_pulled_rows_store_validated_values_as_plain_strings() -> None:
    row = RecordingRow(
        id="018f0000-0000-7000-8000-000000000003",
        user_id="018f0000-0000-7000-8000-000000000001",
        created_at=NOW,
        updated_at=NOW,
        deleted_at=None,
        server_seq=1,
        source="microphone",
        added_at=NOW,
        recorded_at=NOW,
        recorded_precision="time",
        state="ready",
        duration_ms=None,
        playback_mime=None,
        playback_bytes=None,
        error=None,
        source_duration_ms=None,
        playback_start_ms=None,
        playback_end_ms=None,
        playback_rev=None,
        peaks_rev=None,
    )
    assert type(row.model_dump()["state"]) is str
    assert type(row.model_dump()["source"]) is str
    assert type(row.model_dump()["recorded_precision"]) is str


def test_only_slippery_hill_is_importable() -> None:
    assert vocabulary.IMPORTABLE_PROVIDERS == (vocabulary.Provider.SLIPPERY_HILL,)
