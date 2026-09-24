"""Row schemas reject what the database would reject, before the database sees it."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from crosstune import vocabulary
from crosstune.schemas.rows import (
    DATA_SCHEMAS,
    FrettedTuning,
    InstrumentTuning,
    RecordingLinkData,
    RecordingLinkRow,
    TuneData,
    TuneRow,
    Tunings,
    UserSettingsData,
    UserTuneData,
)
from crosstune.sync.tables import TABLE_ORDER, TABLES

NOW = datetime(2026, 9, 11, tzinfo=UTC)


def test_tune_requires_title() -> None:
    with pytest.raises(ValidationError):
        TuneData(created_at=NOW)


def test_tune_accepts_the_modal_mode() -> None:
    assert TuneData(title="Cluck Old Hen", mode="modal", created_at=NOW).mode == "modal"


def test_tune_rejects_unknown_mode() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", mode="lydian", created_at=NOW)


def test_tune_rejects_unknown_time_signature() -> None:
    with pytest.raises(ValidationError):
        TuneData(title="Sally Ann", time_signature="7/8", created_at=NOW)


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


def test_tune_row_derives_the_legacy_tuning_fields() -> None:
    row = TuneRow.model_validate(
        {
            "id": "018f0000-0000-7000-8000-000000000021",
            "owner_user_id": None,
            "title": "Sally Ann",
            "tunings": {"violin": {"tuning": "AEAE"}, "five_string_banjo": {"tuning": "gDGBD"}},
            "created_at": NOW,
            "updated_at": NOW,
            "deleted_at": None,
            "server_seq": 1,
        }
    )
    assert (row.violin_tuning, row.banjo_tuning) == ("AEAE", "gDGBD")


def test_user_settings_reads_banjo_as_the_five_string_banjo() -> None:
    settings = UserSettingsData(instruments=["banjo", "violin"], created_at=NOW)
    assert settings.instruments == ["five_string_banjo", "violin"]


def test_user_settings_merges_both_banjo_spellings_into_one() -> None:
    settings = UserSettingsData(
        instruments=["banjo", "violin", "five_string_banjo"], created_at=NOW
    )
    assert settings.instruments == ["five_string_banjo", "violin"]


def test_user_settings_rejects_a_repeated_legacy_banjo() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["banjo", "banjo"], created_at=NOW)


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
    assert dumped == {"guitar": {"tuning": None, "capo": 3}}
