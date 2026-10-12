"""The inactivity warning emails: copy, counts, dates, and idempotency keys."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta, timezone

import pytest

from crosstune.inactivity.emails import idempotency_key, warning_email
from crosstune.inactivity.rules import Step

DELETION = datetime(2027, 10, 5, 9, 0, tzinfo=UTC)
LAST_ACTIVE = datetime(2026, 10, 5, 9, 0, tzinfo=UTC)
ORIGIN = "https://app.crosstune.app"


def build(step: Step = Step.FIRST, recordings: int = 2, scans: int = 1, **overrides):
    kwargs = {
        "to": "a@example.com",
        "step": step,
        "deletion_on": DELETION,
        "last_active": LAST_ACTIVE,
        "recordings": recordings,
        "scans": scans,
        "web_origin": ORIGIN,
    }
    return warning_email(**{**kwargs, **overrides})


def test_first_subject_and_body() -> None:
    message = build()
    assert message.to == "a@example.com"
    assert message.subject == "Your Crosstune recordings will be deleted on October 5, 2027"
    assert "has not synced since October 5, 2026." in message.text
    assert (
        "On October 5, 2027, Crosstune will delete the 2 recordings and 1 scan in your\n"
        in message.text
    )
    assert f"{ORIGIN}/settings/import-export" in message.text
    assert not message.text.startswith("This is the last reminder.")


def test_second_subject_and_lead() -> None:
    message = build(Step.SECOND)
    assert message.subject == "In 7 days, Crosstune deletes your recordings"
    assert message.text.startswith("This is the last reminder.")
    assert "October 5, 2027" in message.text


@pytest.mark.parametrize(
    ("recordings", "scans", "counts"),
    [(1, 0, "1 recording"), (2, 1, "2 recordings and 1 scan"), (0, 3, "3 scans")],
)
def test_counts(recordings: int, scans: int, counts: str) -> None:
    body = " ".join(build(recordings=recordings, scans=scans).text.split())
    assert f"delete the {counts} in your account." in body


def test_an_account_without_files_gets_no_warning() -> None:
    with pytest.raises(ValueError, match="0 recordings and 0 scans"):
        build(recordings=0, scans=0)


@pytest.mark.parametrize("field", ["deletion_on", "last_active"])
def test_naive_dates_rejected(field: str) -> None:
    with pytest.raises(ValueError, match="no timezone"):
        build(**{field: datetime(2027, 10, 5, 9, 0)})  # noqa: DTZ001 -- naive on purpose


def test_idempotency_key_rejects_a_naive_date() -> None:
    with pytest.raises(ValueError, match="no timezone"):
        idempotency_key(uuid.uuid4(), datetime(2026, 1, 2), Step.FIRST)  # noqa: DTZ001 -- naive on purpose


@pytest.mark.parametrize("step", [Step.NONE, Step.DELETE, Step.RESET])
def test_other_steps_rejected(step: Step) -> None:
    with pytest.raises(ValueError, match="step"):
        build(step)


def test_dates_use_utc_without_padding() -> None:
    zone = timezone(timedelta(hours=-5))
    late = datetime(2027, 10, 4, 22, 0, tzinfo=zone)  # 03:00 UTC on Oct 5
    assert "October 5, 2027" in build(deletion_on=late).subject
    early = datetime(2027, 3, 1, tzinfo=UTC)
    assert build(deletion_on=early).subject.endswith("March 1, 2027")


def test_html_has_one_link_and_escapes() -> None:
    message = build(web_origin='https://x.test/"><b>')
    assert message.html.count("<a ") == 1
    assert "<b>" not in message.html
    assert "<img" not in message.html
    plain = build().html
    assert "Settings &gt; Import and export &gt; Export data." in plain
    assert f'href="{ORIGIN}/settings/import-export"' in plain
    assert "has not synced since October 5, 2026." in plain
    assert "delete the 2 recordings and 1 scan in your account." in plain


def test_an_origin_ending_in_a_slash_gives_one_export_link() -> None:
    message = build(web_origin="https://my.crosstune.app/")
    link = "https://my.crosstune.app/settings/import-export"
    assert link in message.text
    assert f'href="{link}"' in message.html


def test_idempotency_key() -> None:
    user = uuid.UUID("11111111-1111-1111-1111-111111111111")
    since = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    key = idempotency_key(user, since, Step.FIRST)
    assert key == f"inactivity/{user}/20260102T030405Z/first"
    assert key == idempotency_key(user, since, Step.FIRST)
    assert key != idempotency_key(user, since, Step.SECOND)
    assert key != idempotency_key(user, since + timedelta(seconds=1), Step.FIRST)
    zone = timezone(timedelta(hours=2))
    assert key == idempotency_key(user, since.astimezone(zone), Step.FIRST)
