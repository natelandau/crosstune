"""The shared HTML body: escaping and linking."""

from __future__ import annotations

from crosstune.email.layout import html_body


def test_a_link_that_prefixes_another_does_not_break_it() -> None:
    html = html_body(
        ["See https://crosstune.app/terms and https://crosstune.app/terms/changes."],
        ["https://crosstune.app/terms", "https://crosstune.app/terms/changes"],
    )

    assert '<a href="https://crosstune.app/terms">https://crosstune.app/terms</a> and ' in html
    assert (
        '<a href="https://crosstune.app/terms/changes">https://crosstune.app/terms/changes</a>.'
        in html
    )
    assert html.count("<a ") == 2


def test_a_repeated_link_is_linked_each_time() -> None:
    html = html_body(["https://a.example/x then https://a.example/x"], ["https://a.example/x"])

    assert html.count("<a ") == 2
