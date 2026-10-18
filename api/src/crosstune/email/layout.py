"""Pieces shared by the transactional emails: UTC dates and the HTML body."""

from __future__ import annotations

import re
from datetime import UTC, date, datetime
from html import escape


def to_utc(moment: datetime) -> datetime:
    """Return the same instant in UTC.

    Raises:
        ValueError: `moment` is naive, so the instant it names is unknown.
    """
    if moment.tzinfo is None or moment.utcoffset() is None:
        msg = f"{moment!r} has no timezone"
        raise ValueError(msg)
    return moment.astimezone(UTC)


def format_date(day: date) -> str:
    """Spell a date the way every email does, as "October 5, 2027", with no padding."""
    return f"{day:%B} {day.day}, {day.year}"


def html_body(paragraphs: list[str], links: list[str]) -> str:
    """Wrap plain-text paragraphs in an HTML body, escaping them and linking each URL.

    Args:
        paragraphs: The text paragraphs, whose line breaks become spaces.
        links: URLs to turn into anchors wherever they appear.
    """
    # One pass, longest URL first, so a URL that prefixes another cannot link inside it.
    pattern = (
        re.compile(
            "|".join(re.escape(escape(url)) for url in sorted(set(links), key=len, reverse=True))
        )
        if links
        else None
    )
    html_paragraphs = []
    for paragraph in paragraphs:
        body = escape(paragraph)
        if pattern:
            body = pattern.sub(lambda match: f'<a href="{match[0]}">{match[0]}</a>', body)
        html_paragraphs.append(f"<p>{body.replace(chr(10), ' ')}</p>")
    return (
        '<!doctype html><html><body style="font-family: sans-serif; line-height: 1.5;">'
        + "".join(html_paragraphs)
        + "</body></html>"
    )
