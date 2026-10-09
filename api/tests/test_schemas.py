"""Row schemas reject what the database would reject, before the database sees it."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from crosstune import vocabulary
from crosstune.schemas.rows import (
    DATA_SCHEMAS,
    FrettedTuning,
    InstrumentTuning,
    PlayEventData,
    PracticeSessionData,
    RecordingLinkData,
    RecordingLinkRow,
    ScanViewData,
    TuneData,
    TuneRow,
    Tunings,
    UserSettingsData,
    UserTuneData,
)
from crosstune.sync.tables import TABLE_ORDER, TABLES
from crosstune.vocabulary import SPEED_PERCENT_MAX, SPEED_PERCENT_MIN

NOW = datetime(2026, 9, 11, tzinfo=UTC)


def test_tune_requires_title() -> None:
    with pytest.raises(ValidationError):
        TuneData(created_at=NOW)


def test_tune_accepts_the_modal_mode() -> None:
    assert TuneData(title="Cluck Old Hen", modes=["modal"], created_at=NOW).modes == ["modal"]


def test_tune_rejects_unknown_time_signature() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", time_signature="7/8", created_at=NOW)


def test_tune_accepts_type_modes_and_composer() -> None:
    tune = TuneData(
        title="The Mason's Apron",
        tune_type="Reel",
        modes=["major", "minor"],
        composer="Traditional",
        created_at=NOW,
    )
    assert (tune.tune_type, tune.modes, tune.composer) == (
        "Reel",
        ["major", "minor"],
        "Traditional",
    )


def test_tune_rejects_a_fifth_mode() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", modes=["major"] * 5, created_at=NOW)


def test_tune_rejects_an_unknown_part_mode() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", modes=["major", "lydian"], created_at=NOW)


def test_tune_refuses_the_retired_feel_and_mode_fields() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", feel="Reel", created_at=NOW)
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", mode="major", created_at=NOW)


def test_tune_defaults_to_no_modes() -> None:
    assert TuneData(title="Sally Ann", created_at=NOW).modes == []


def test_tune_refuses_null_modes() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", modes=None, created_at=NOW)


def test_tune_accepts_three_two_time() -> None:
    assert (
        TuneData(title="Dusty Miller", time_signature="3/2", created_at=NOW).time_signature == "3/2"
    )


def test_tune_rejects_a_composer_past_the_cap() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", composer="x" * 201, created_at=NOW)


def test_tune_rejects_owner_field() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", owner_user_id="abc", created_at=NOW)


def test_user_tune_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        UserTuneData(
            tune_id="018f0000-0000-7000-8000-000000000002", status="mastered", created_at=NOW
        )


def test_recording_link_rejects_unknown_provider() -> None:
    with pytest.raises(ValidationError):
        RecordingLinkData(
            tune_id="018f0000-0000-7000-8000-000000000002",
            url="https://example.com",
            provider="napster",
            created_at=NOW,
        )


def _link(url: str) -> RecordingLinkData:
    return RecordingLinkData(
        tune_id="018f0000-0000-7000-8000-000000000002", url=url, provider="other", created_at=NOW
    )


@pytest.mark.parametrize(
    "url",
    [
        "https://example.com/x",
        "HTTP://example.com/x",
        "example.com/x",
        "  https://example.com/x",
        "http://[abc",
    ],
)
def test_recording_link_accepts_web_and_scheme_less_urls(url: str) -> None:
    assert _link(url).url == url


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        " JavaScript:alert(1)",
        "java\tscript:alert(1)",
        "\x01javascript:alert(1)",
        "javascript\n:alert(1)",
        "data:text/html,<p>x</p>",
        "ftp://example.com/x",
        "example.com:8080/x",
    ],
)
def test_recording_link_rejects_a_non_web_scheme(url: str) -> None:
    with pytest.raises(ValidationError, match="http or https"):
        _link(url)


def test_a_stored_link_row_is_never_rechecked() -> None:
    row = RecordingLinkRow(
        id="018f0000-0000-7000-8000-000000000003",
        tune_id="018f0000-0000-7000-8000-000000000002",
        url="javascript:alert(1)",
        provider="other",
        created_at=NOW,
        updated_at=NOW,
        deleted_at=None,
        server_seq=1,
        added_by_user_id="018f0000-0000-7000-8000-000000000004",
    )
    assert row.url == "javascript:alert(1)"


def test_every_table_has_a_schema_and_a_spec() -> None:
    assert set(DATA_SCHEMAS) == set(TABLE_ORDER) == set(TABLES)


# A merged tune points at the tune it merged into; deleting that tune keeps the pointer.
NOT_CASCADED = {("tunes", "merged_into_id")}


def test_every_foreign_key_between_synced_tables_cascades_a_delete() -> None:
    by_table = {spec.model.__tablename__: name for name, spec in TABLES.items()}
    foreign_keys = {
        (by_table[fk.column.table.name], name, column.name)
        for name, spec in TABLES.items()
        for column in spec.model.__table__.columns
        for fk in column.foreign_keys
        if fk.column.table.name in by_table and (name, column.name) not in NOT_CASCADED
    }
    declared = {
        (parent, child, column)
        for parent, spec in TABLES.items()
        for child, column in spec.children
    }
    assert foreign_keys == declared


def test_tune_rejects_the_retired_tuning_field() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", tuning="AEAE", created_at=NOW)


def test_tune_accepts_a_tunings_map() -> None:
    tune = TuneData(
        title="Sally Ann",
        tunings={"violin": {"tuning": "Cross A (AEAE)"}},
        created_at=NOW,
    )
    assert tune.model_dump()["tunings"] == {"violin": {"tuning": "Cross A (AEAE)"}}


def test_tune_defaults_to_no_tunings() -> None:
    assert TuneData(title="Sally Ann", created_at=NOW).model_dump()["tunings"] == {}


@pytest.mark.parametrize("field", ["violin_tuning", "banjo_tuning"])
def test_tune_rejects_a_legacy_tuning_field(field: str) -> None:
    with pytest.raises(ValidationError):
        TuneData.model_validate({"title": "Sally Ann", field: "AEAE", "created_at": NOW})


def test_tune_row_carries_no_legacy_tuning_fields() -> None:
    assert not {"violin_tuning", "banjo_tuning"} & set(TuneRow.model_fields)


def test_user_settings_rejects_banjo() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["banjo"], created_at=NOW)


def test_user_settings_rejects_unknown_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["kazoo"], created_at=NOW)


def test_user_settings_rejects_a_retired_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["other"], created_at=NOW)


def test_user_settings_accepts_every_instrument() -> None:
    every = [i.value for i in vocabulary.Instrument]
    assert UserSettingsData(instruments=every, created_at=NOW).instruments == every


def test_user_settings_rejects_a_repeated_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["violin", "violin"], created_at=NOW)


def test_user_settings_defaults_to_no_instruments() -> None:
    assert UserSettingsData(created_at=NOW).instruments == []


def test_tune_accepts_lyrics_at_the_cap() -> None:
    data = TuneData(title="Sally Ann", lyrics="a" * 20_000, created_at=NOW)
    assert data.lyrics is not None
    assert len(data.lyrics) == 20_000


def test_tune_rejects_lyrics_past_the_cap() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", lyrics="a" * 20_001, created_at=NOW)


def test_tune_rejects_the_removed_has_lyrics_field() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", has_lyrics=True, created_at=NOW)


def test_tunings_has_one_field_per_instrument() -> None:
    assert set(Tunings.model_fields) == {i.value for i in vocabulary.Instrument}


def test_only_fretted_instruments_take_a_capo() -> None:
    for name, field in Tunings.model_fields.items():
        entry_type = next(a for a in field.annotation.__args__ if a is not type(None))
        expected = FrettedTuning if name in vocabulary.FRETTED else InstrumentTuning
        assert entry_type is expected, name


def test_tunings_reject_an_unknown_instrument() -> None:
    with pytest.raises(ValidationError):
        Tunings.model_validate({"kazoo": {"tuning": "x"}})


def test_tunings_reject_a_capo_on_violin() -> None:
    with pytest.raises(ValidationError):
        Tunings.model_validate({"violin": {"tuning": "Cross A (AEAE)", "capo": 2}})


@pytest.mark.parametrize("capo", [0, 13, -1])
def test_tunings_reject_a_capo_out_of_range(capo: int) -> None:
    with pytest.raises(ValidationError):
        Tunings.model_validate({"guitar": {"tuning": "DADGAD", "capo": capo}})


def test_tunings_reject_a_tuning_past_the_cap() -> None:
    with pytest.raises(ValidationError):
        Tunings.model_validate({"guitar": {"tuning": "a" * 101}})


def test_tunings_dump_drops_empty_entries() -> None:
    tunings = Tunings.model_validate(
        {
            "violin": {"tuning": "Cross A (AEAE)"},
            "guitar": {"tuning": None, "capo": None},
            "five_string_banjo": {"tuning": "Open G (gDGBD)", "capo": 2},
        }
    )
    assert tunings.model_dump() == {
        "violin": {"tuning": "Cross A (AEAE)"},
        "five_string_banjo": {"tuning": "Open G (gDGBD)", "capo": 2},
    }


def test_tunings_keep_a_capo_without_a_tuning() -> None:
    dumped = Tunings.model_validate({"guitar": {"capo": 3}}).model_dump()
    assert dumped == {"guitar": {"capo": 3}}


def test_user_settings_search_providers_default_is_every_searchable_provider() -> None:
    providers = UserSettingsData(created_at=NOW).search_providers
    assert providers == list(vocabulary.SEARCHABLE_PROVIDERS)
    assert "other" not in providers


@pytest.mark.parametrize("value", [["other"], ["spotify", "other"], ["spotify", "spotify"]])
def test_user_settings_search_providers_rejects_other_and_repeats(value: list[str]) -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(search_providers=value, created_at=NOW)


def test_user_settings_search_providers_may_be_empty() -> None:
    assert UserSettingsData(search_providers=[], created_at=NOW).search_providers == []


def test_user_tune_accepts_one_play_source() -> None:
    tune = "018f0000-0000-7000-8000-000000000002"
    pin = "018f0000-0000-7000-8000-000000000003"
    by_recording = UserTuneData(tune_id=tune, status="known", play_recording_id=pin, created_at=NOW)
    by_link = UserTuneData(tune_id=tune, status="known", play_link_id=pin, created_at=NOW)
    assert str(by_recording.play_recording_id) == pin
    assert str(by_link.play_link_id) == pin


def test_user_tune_rejects_two_play_sources() -> None:
    with pytest.raises(ValidationError):
        UserTuneData(
            tune_id="018f0000-0000-7000-8000-000000000002",
            status="known",
            play_recording_id="018f0000-0000-7000-8000-000000000003",
            play_link_id="018f0000-0000-7000-8000-000000000004",
            created_at=NOW,
        )


def test_user_settings_play_first_defaults_to_recordings() -> None:
    assert UserSettingsData(created_at=NOW).play_first == "recordings"


def test_user_settings_rejects_unknown_play_first() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(play_first="spotify", created_at=NOW)


def test_user_settings_rejects_a_null_play_first() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(play_first=None, created_at=NOW)


def test_user_settings_new_tunes_start_with_no_genre_and_want_to_learn() -> None:
    settings = UserSettingsData(created_at=NOW)
    assert settings.new_tune_genre is None
    assert settings.new_tune_status == "want_to_learn"


def test_user_settings_rejects_unknown_new_tune_status() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(new_tune_status="mastered", created_at=NOW)


@pytest.mark.parametrize("genre", ["", "x" * 101])
def test_user_settings_rejects_an_empty_or_long_new_tune_genre(genre: str) -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(new_tune_genre=genre, created_at=NOW)


RECORDING_ID = "018f0000-0000-7000-8000-000000000001"


def test_play_from_a_list_carries_its_list() -> None:
    play = PlayEventData(
        recording_id=RECORDING_ID,
        context="list",
        list_id="018f0000-0000-7000-8000-000000000002",
        started_at=NOW,
        listened_ms=10_000,
        created_at=NOW,
    )
    assert play.context == "list"


def test_play_rejects_a_list_outside_the_list_context() -> None:
    with pytest.raises(ValidationError, match="list_id"):
        PlayEventData(
            recording_id=RECORDING_ID,
            context="dock",
            list_id="018f0000-0000-7000-8000-000000000002",
            started_at=NOW,
            listened_ms=10_000,
            created_at=NOW,
        )


def test_play_rejects_negative_listened_time() -> None:
    with pytest.raises(ValidationError):
        PlayEventData(
            recording_id=RECORDING_ID,
            context="row",
            started_at=NOW,
            listened_ms=-1,
            created_at=NOW,
        )


@pytest.mark.parametrize("speed", [SPEED_PERCENT_MIN - 1, SPEED_PERCENT_MAX + 1])
def test_practice_session_rejects_a_speed_out_of_range(speed: int) -> None:
    with pytest.raises(ValidationError):
        PracticeSessionData(
            recording_id=RECORDING_ID,
            started_at=NOW,
            duration_ms=60_000,
            speed_percent=speed,
            pitch_cents=0,
            created_at=NOW,
        )


def test_practice_session_rejects_an_owner() -> None:
    with pytest.raises(ValidationError):
        PracticeSessionData(
            recording_id=RECORDING_ID,
            started_at=NOW,
            duration_ms=60_000,
            speed_percent=100,
            pitch_cents=0,
            user_id="018f0000-0000-7000-8000-000000000003",
            created_at=NOW,
        )


def test_scan_view_from_a_list_carries_its_list() -> None:
    view = ScanViewData(
        tune_id=RECORDING_ID,
        context="list",
        list_id="018f0000-0000-7000-8000-000000000002",
        started_at=NOW,
        viewed_ms=10_000,
        created_at=NOW,
    )
    assert view.context == "list"


def test_scan_view_rejects_a_list_outside_the_list_context() -> None:
    with pytest.raises(ValidationError, match="list_id"):
        ScanViewData(
            tune_id=RECORDING_ID,
            context="row",
            list_id="018f0000-0000-7000-8000-000000000002",
            started_at=NOW,
            viewed_ms=10_000,
            created_at=NOW,
        )
