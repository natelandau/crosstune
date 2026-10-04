"""The Slippery-Hill tune page parser reads the title and audio file from a Drupal node."""

from __future__ import annotations

from pathlib import Path

from crosstune.links.slippery_hill import TunePage, parse_tune_page

FIXTURES = Path(__file__).parent / "fixtures" / "slippery_hill"


def fixture(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def field(name: str, item: str | None) -> str:
    body = f'<div class="field__item">{item}</div>' if item is not None else ""
    return (
        f'<div class="field field--name-{name} field--label-inline">'
        f'<div class="field__label">Label</div>{body}</div>'
    )


def test_reads_title_and_artist_and_file() -> None:
    page = parse_tune_page(fixture("bear-creek-sally-goodin.html"))
    assert page == TunePage(
        "Bear Creek Sally Goodin - Bob Holt", "recordings/bearcreeksallygoodin_bobholt.mp3"
    )


def test_reads_an_encoded_78_path() -> None:
    page = parse_tune_page(fixture("what-a-glad-day.html"))
    assert page == TunePage(
        "What A Glad Day - Wright Brothers Quartet",
        "78s/15402%20What%20A%20Glad%20Day%20%20%28Wright%20Brothers%20Quartet%29.mp3",
    )


def test_falls_back_to_the_title_tag() -> None:
    page = parse_tune_page("<html><head><title>Sally Ann | Slippery-Hill</title></head></html>")
    assert page == TunePage("Sally Ann", None)


def test_reads_an_absolute_source_on_the_bare_host() -> None:
    html = '<audio><source src="https://slippery-hill.com/system/files/recordings/x.mp3"></audio>'
    assert parse_tune_page(html).ref == "recordings/x.mp3"


def test_ignores_a_source_off_the_host() -> None:
    html = '<audio><source src="https://evil.example/system/files/x.mp3"></audio>'
    assert parse_tune_page(html).ref is None


def test_a_field_with_no_item_is_skipped() -> None:
    html = (
        "<div>"
        + field("field-r-tune-title", None)
        + field("field-r-source", "<span>Bob Holt</span>")
        + "</div>"
    )
    assert parse_tune_page(html).title == "Bob Holt"


def test_source_wins_over_source_term() -> None:
    html = (
        field("field-r-tune-title", "Tune")
        + field("field-r-source-term", "<a>Term Artist</a>")
        + field("field-r-source", "Source Artist")
    )
    assert parse_tune_page(html).title == "Tune - Source Artist"


def test_source_term_used_when_source_has_no_text() -> None:
    html = (
        field("field-r-tune-title", "Tune")
        + field("field-r-source", None)
        + field("field-r-source-term", "Term Artist")
    )
    assert parse_tune_page(html).title == "Tune - Term Artist"


def test_prefers_the_uploaded_file_player() -> None:
    html = (
        '<audio><source src="/system/files/recordings/related.mp3"></audio>'
        '<div class="field field--name-field-r-uploaded-file"><div class="field__item">'
        '<audio><source src="/system/files/recordings/main.mp3"></audio></div></div>'
    )
    assert parse_tune_page(html).ref == "recordings/main.mp3"


def test_falls_back_to_any_audio_without_an_uploaded_file_field() -> None:
    html = '<audio><source src="/system/files/recordings/only.mp3"></audio>'
    assert parse_tune_page(html).ref == "recordings/only.mp3"


def test_reads_text_through_a_nested_div() -> None:
    html = field("field-r-tune-title", "<div><span>Sally</span></div> Ann")
    assert parse_tune_page(html).title == "Sally Ann"


def test_ignores_a_second_item() -> None:
    html = (
        '<div class="field field--name-field-r-tune-title">'
        '<div class="field__item">First</div><div class="field__item">Second</div></div>'
    )
    assert parse_tune_page(html).title == "First"


def test_collapses_whitespace() -> None:
    html = field("field-r-tune-title", "  Sally \n\t  Ann  ")
    assert parse_tune_page(html).title == "Sally Ann"


def test_reads_an_audio_src_with_no_source() -> None:
    html = '<audio src="/system/files/recordings/a.mp3"></audio>'
    assert parse_tune_page(html).ref == "recordings/a.mp3"


def test_refuses_a_protocol_relative_off_host_src() -> None:
    html = '<audio><source src="//evil.example/system/files/x.mp3"></audio>'
    assert parse_tune_page(html).ref is None
