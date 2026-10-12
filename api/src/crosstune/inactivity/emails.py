"""The two warning emails sent before an inactive account's recordings are deleted."""

from __future__ import annotations

from datetime import UTC, datetime
from html import escape
from typing import TYPE_CHECKING

from crosstune.email.resend import EmailMessage
from crosstune.inactivity.rules import Step

if TYPE_CHECKING:
    import uuid

SUPPORT_ADDRESS = "support@crosstune.app"


def _utc(moment: datetime) -> datetime:
    """The same instant in UTC.

    Raises:
        ValueError: `moment` is naive, so the instant it names is unknown.
    """
    if moment.tzinfo is None or moment.utcoffset() is None:
        msg = f"{moment!r} has no timezone"
        raise ValueError(msg)
    return moment.astimezone(UTC)


def _date(moment: datetime) -> str:
    moment = _utc(moment)
    return f"{moment:%B} {moment.day}, {moment.year}"


def _plural(count: int, noun: str) -> str:
    return f"{count} {noun}" if count == 1 else f"{count} {noun}s"


def _counts(recordings: int, scans: int) -> str:
    """Name the files the warning is about, as "2 recordings and 1 scan".

    Raises:
        ValueError: Neither count is positive, so there is nothing to warn about.
    """
    if recordings < 0 or scans < 0 or recordings + scans == 0:
        msg = f"No warning email for {recordings} recordings and {scans} scans"
        raise ValueError(msg)
    parts = []
    if recordings:
        parts.append(_plural(recordings, "recording"))
    if scans:
        parts.append(_plural(scans, "scan"))
    return " and ".join(parts)


def idempotency_key(user_id: uuid.UUID, active_since: datetime, step: Step) -> str:
    """Name one warning so a retry of the same send never mails twice."""
    return f"inactivity/{user_id}/{_utc(active_since):%Y%m%dT%H%M%SZ}/{step}"


def warning_email(
    *,
    to: str,
    step: Step,
    deletion_on: datetime,
    last_active: datetime,
    recordings: int,
    scans: int,
    web_origin: str,
) -> EmailMessage:
    """Build the first or second warning for an account due to lose its recordings.

    Raises:
        ValueError: `step` is not a warning, the account holds no recordings or scans,
            or a date is naive.
    """
    if step not in (Step.FIRST, Step.SECOND):
        msg = f"No warning email for step {step!r}"
        raise ValueError(msg)

    date = _date(deletion_on)
    export_url = f"{web_origin.rstrip('/')}/settings/import-export"
    if step is Step.FIRST:
        subject = f"Your Crosstune recordings will be deleted on {date}"
    else:
        subject = "In 7 days, Crosstune deletes your recordings"

    paragraphs = [
        (
            f"Your Crosstune account has not synced since {_date(last_active)}. When an\n"
            "account without Premium goes a year without syncing, Crosstune deletes\n"
            "its recordings and scans."
        ),
        (
            f"On {date}, Crosstune will delete the {_counts(recordings, scans)} in your\n"
            "account. Your tunes, lists, and settings stay."
        ),
        (
            "To keep everything, open Crosstune on any device and let it sync. That\n"
            "is all it takes."
        ),
        (
            f"To save a copy first, export everything at {export_url}.\n"
            "In the Apple app, it is Settings > Import and export > Export data."
        ),
        f"Replies to this address are not read. For help, write to\n{SUPPORT_ADDRESS}.",
    ]
    if step is Step.SECOND:
        paragraphs.insert(0, "This is the last reminder.")

    text = "\n\n".join(paragraphs)

    link = f'<a href="{escape(export_url)}">{escape(export_url)}</a>'
    html_paragraphs = [
        f"<p>{escape(paragraph).replace(escape(export_url), link).replace(chr(10), ' ')}</p>"
        for paragraph in paragraphs
    ]
    html = (
        '<!doctype html><html><body style="font-family: sans-serif; line-height: 1.5;">'
        + "".join(html_paragraphs)
        + "</body></html>"
    )
    return EmailMessage(to=to, subject=subject, text=text, html=html)
