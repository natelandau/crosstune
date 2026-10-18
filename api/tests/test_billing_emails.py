"""The purchase, renewal, and refund emails: copy per store, legal links, escaping."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest

from crosstune.billing.emails import (
    APPLE_CANCEL_PATH,
    PRIVACY_URL,
    STRIPE_CANCEL_PATH,
    TERMS_URL,
    WITHDRAWAL_LINE,
    confirmation_email,
    notice_key,
    renewal_reminder_email,
    withdrawal_email,
)
from crosstune.vocabulary import GrantPeriod, GrantSource

ORIGIN = "https://app.crosstune.app"
STORES = [GrantSource.STRIPE, GrantSource.APPLE]


def flat(text: str) -> str:
    return " ".join(text.split())


def cancel_path(source: GrantSource) -> str:
    return STRIPE_CANCEL_PATH if source is GrantSource.STRIPE else APPLE_CANCEL_PATH


@pytest.mark.parametrize("source", STORES)
@pytest.mark.parametrize(
    ("period", "billed"), [(GrantPeriod.MONTH, "month"), (GrantPeriod.YEAR, "year")]
)
def test_confirmation_body(source: GrantSource, period: GrantPeriod, billed: str) -> None:
    message = confirmation_email(
        to="a@example.com", source=source, period=period, web_origin=ORIGIN
    )
    body = flat(message.text)
    assert message.to == "a@example.com"
    assert message.subject == "Your Crosstune Premium subscription"
    assert f"each {billed}" in body
    assert "renews automatically until you cancel" in body
    assert flat(cancel_path(source).format(web_origin=ORIGIN)) in body
    assert TERMS_URL in message.text
    assert PRIVACY_URL in message.text
    assert (WITHDRAWAL_LINE in body) is (source is GrantSource.STRIPE)
    assert "fiddle" not in body.lower()
    assert "\u2014" not in message.text


def test_a_web_receipt_omits_the_withdrawal_once_the_account_used_it() -> None:
    message = confirmation_email(
        to="a@example.com",
        source=GrantSource.STRIPE,
        period=GrantPeriod.MONTH,
        web_origin=ORIGIN,
        already_withdrew=True,
    )
    body = flat(message.text)
    assert WITHDRAWAL_LINE not in body
    assert "refund" not in body.lower()


def test_confirmation_html_links_and_escapes() -> None:
    message = confirmation_email(
        to="a@example.com",
        source=GrantSource.STRIPE,
        period=GrantPeriod.YEAR,
        web_origin="https://app.crosstune.app/?a=1&b=<2>",
    )
    assert f'<a href="{TERMS_URL}">{TERMS_URL}</a>' in message.html
    assert f'<a href="{PRIVACY_URL}">{PRIVACY_URL}</a>' in message.html
    assert "a=1&amp;b=&lt;2&gt;" in message.html
    assert "<2>" not in message.html


@pytest.mark.parametrize("source", STORES)
def test_renewal_reminder(source: GrantSource) -> None:
    message = renewal_reminder_email(
        to="a@example.com", source=source, renews_on=date(2027, 3, 5), web_origin=ORIGIN
    )
    body = flat(message.text)
    assert message.subject == "Your Crosstune Premium renews on March 5, 2027"
    assert "renews on March 5, 2027 for another year at the current price" in body
    assert flat(cancel_path(source).format(web_origin=ORIGIN)) in body
    assert "before March 5, 2027" in body
    assert WITHDRAWAL_LINE not in body


def test_withdrawal_email() -> None:
    message = withdrawal_email(to="a@example.com", web_origin=ORIGIN)
    body = flat(message.text)
    assert message.subject == "Your Crosstune Premium refund"
    assert "first payment was refunded in full" in body
    assert "Premium has ended" in body
    assert "5 to 10 business days" in body
    assert f"Your tune catalog stays in your account at {ORIGIN}." in body
    assert f'<a href="{ORIGIN}">' in message.html


def test_withdrawal_email_after_an_account_deletion_says_the_data_is_gone() -> None:
    message = withdrawal_email(to="a@example.com", web_origin=ORIGIN, account_deleted=True)
    body = flat(message.text)
    assert "first payment was refunded in full" in body
    assert "Your Crosstune account and its data were deleted." in body
    assert "catalog" not in body
    assert ORIGIN not in message.text
    assert ORIGIN not in message.html


def test_html_escapes_the_origin_in_every_email() -> None:
    origin = "https://x.test/?a=1&b=<2>"
    messages = [
        renewal_reminder_email(
            to="a@example.com",
            source=GrantSource.STRIPE,
            renews_on=date(2027, 3, 5),
            web_origin=origin,
        ),
        withdrawal_email(to="a@example.com", web_origin=origin),
    ]
    for message in messages:
        assert "<2>" not in message.html


def test_other_sources_get_no_email() -> None:
    with pytest.raises(ValueError, match="source"):
        confirmation_email(
            to="a@example.com", source=GrantSource.COMP, period=GrantPeriod.YEAR, web_origin=ORIGIN
        )


def test_notice_key_names_one_notice() -> None:
    end = datetime(2027, 3, 5, 9, 0, tzinfo=timezone(timedelta(hours=2)))
    assert notice_key("renewal", "sub_1", end) == "billing/renewal/sub_1/20270305T070000Z"
    assert notice_key("renewal", "sub_1", end) != notice_key("confirmation", "sub_1", end)
    assert notice_key("withdrawal", "sub_1", None) == "billing/withdrawal/sub_1/none"
    with pytest.raises(ValueError, match="no timezone"):
        notice_key("renewal", "sub_1", datetime(2027, 3, 5, 9, 0))  # noqa: DTZ001
