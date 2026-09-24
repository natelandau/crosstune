"""Row schemas reject what the database would reject, before the database sees it."""

from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from crosstune.schemas.rows import (
    DATA_SCHEMAS,
    RecordingLinkData,
    RecordingLinkRow,
    SongData,
    UserSettingsData,
    UserSongData,
)
from crosstune.sync.tables import TABLE_ORDER, TABLES

NOW = datetime(2026, 9, 11, tzinfo=UTC)


def test_song_requires_title() -> None:
    with pytest.raises(ValidationError):
        SongData(created_at=NOW)


def test_song_accepts_the_modal_mode() -> None:
    assert SongData(title="Cluck Old Hen", mode="modal", created_at=NOW).mode == "modal"


def test_song_rejects_unknown_mode() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", mode="lydian", created_at=NOW)


def test_song_rejects_unknown_time_signature() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", time_signature="7/8", created_at=NOW)


def test_song_rejects_owner_field() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", owner_user_id="abc", created_at=NOW)


def test_user_song_rejects_unknown_status() -> None:
    with pytest.raises(ValidationError):
        UserSongData(
            song_id="018f0000-0000-7000-8000-000000000002", status="mastered", created_at=NOW
        )


def test_recording_link_rejects_unknown_provider() -> None:
    with pytest.raises(ValidationError):
        RecordingLinkData(
            song_id="018f0000-0000-7000-8000-000000000002",
            url="https://example.com",
            provider="napster",
            created_at=NOW,
        )


def _link(url: str) -> RecordingLinkData:
    return RecordingLinkData(
        song_id="018f0000-0000-7000-8000-000000000002", url=url, provider="other", created_at=NOW
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
        song_id="018f0000-0000-7000-8000-000000000002",
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


def test_song_rejects_the_retired_tuning_field() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", tuning="AEAE", created_at=NOW)


def test_song_accepts_a_tuning_per_instrument() -> None:
    song = SongData(title="Sally Ann", violin_tuning="AEAE", banjo_tuning="gDGBD", created_at=NOW)
    assert (song.violin_tuning, song.banjo_tuning) == ("AEAE", "gDGBD")


def test_user_settings_rejects_unknown_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["kazoo"], created_at=NOW)


def test_user_settings_rejects_a_retired_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["other"], created_at=NOW)


def test_user_settings_rejects_a_repeated_instrument() -> None:
    with pytest.raises(ValidationError):
        UserSettingsData(instruments=["violin", "violin"], created_at=NOW)


def test_user_settings_defaults_to_no_instruments() -> None:
    assert UserSettingsData(created_at=NOW).instruments == []


def test_song_accepts_lyrics_at_the_cap() -> None:
    data = SongData(title="Sally Ann", lyrics="a" * 20_000, created_at=NOW)
    assert data.lyrics is not None
    assert len(data.lyrics) == 20_000


def test_song_rejects_lyrics_past_the_cap() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", lyrics="a" * 20_001, created_at=NOW)


def test_song_rejects_the_removed_has_lyrics_field() -> None:
    with pytest.raises(ValidationError):
        SongData(title="Sally Ann", has_lyrics=True, created_at=NOW)
