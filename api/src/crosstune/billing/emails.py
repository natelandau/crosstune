"""The purchase confirmation, yearly renewal reminder, and refund emails."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.email.layout import format_date, html_body, to_utc
from crosstune.email.resend import EmailMessage
from crosstune.vocabulary import GrantPeriod, GrantSource

if TYPE_CHECKING:
    from datetime import date, datetime

TERMS_URL = "https://crosstune.app/terms"
PRIVACY_URL = "https://crosstune.app/privacy"

# The web labels are `Manage subscription` and `Withdraw for a full refund`.
STRIPE_CANCEL_PATH = "Manage subscription on the Plan page at {web_origin}"
APPLE_CANCEL_PATH = "Subscriptions in your Apple Account settings"
WITHDRAWAL_LINE = (
    "You can withdraw within 14 days of your first payment for a full refund, "
    "with Withdraw for a full refund on the Plan page."
)


def _cancel_path(source: GrantSource, web_origin: str) -> str:
    """Name where a buyer cancels, which depends on the store that bills them.

    Raises:
        ValueError: `source` is not a store that bills a subscription.
    """
    if source is GrantSource.STRIPE:
        return STRIPE_CANCEL_PATH.format(web_origin=web_origin.rstrip("/"))
    if source is GrantSource.APPLE:
        return APPLE_CANCEL_PATH
    msg = f"No billing email for source {source!r}"
    raise ValueError(msg)


def notice_key(kind: str, subscription_id: str, period_end: datetime | None) -> str:
    """Name one notice so a retry of the same send never mails twice."""
    stamp = "none" if period_end is None else f"{to_utc(period_end):%Y%m%dT%H%M%SZ}"
    return f"billing/{kind}/{subscription_id}/{stamp}"


def _message(*, to: str, subject: str, paragraphs: list[str], links: list[str]) -> EmailMessage:
    return EmailMessage(
        to=to,
        subject=subject,
        text="\n\n".join(paragraphs),
        html=html_body(paragraphs, links),
    )


def confirmation_email(
    *,
    to: str,
    source: GrantSource,
    period: GrantPeriod,
    web_origin: str,
    already_withdrew: bool = False,
) -> EmailMessage:
    """Build the receipt that tells a new subscriber how billing, renewal, and cancelling work.

    A web receipt offers the withdrawal only to an account that has not used it, since each
    account may withdraw once.

    Raises:
        ValueError: `source` is not a store that bills a subscription.
    """
    cancel = _cancel_path(source, web_origin)
    paragraphs = [
        (
            "Thank you for subscribing to Crosstune Premium.\n"
            f"Premium is billed each {period.value}. It renews automatically until you cancel."
        ),
        f"To cancel, use {cancel}.",
    ]
    if source is GrantSource.STRIPE and not already_withdrew:
        paragraphs.append(WITHDRAWAL_LINE)
    paragraphs.append(
        f"Terms: {TERMS_URL}\nPrivacy: {PRIVACY_URL}",
    )
    links = [TERMS_URL, PRIVACY_URL]
    if source is GrantSource.STRIPE:
        links.insert(0, web_origin.rstrip("/"))
    return _message(
        to=to,
        subject="Your Crosstune Premium subscription",
        paragraphs=paragraphs,
        links=links,
    )


def renewal_reminder_email(
    *, to: str, source: GrantSource, renews_on: date, web_origin: str
) -> EmailMessage:
    """Build the notice sent ahead of a yearly renewal, with the way to cancel first.

    Raises:
        ValueError: `source` is not a store that bills a subscription.
    """
    day = format_date(renews_on)
    cancel = _cancel_path(source, web_origin)
    paragraphs = [
        f"Your Crosstune Premium subscription renews on {day} for another year\nat the current price.",
        f"To cancel, use {cancel}.\nCancel before {day} to avoid the renewal.",
    ]
    links = [web_origin.rstrip("/")] if source is GrantSource.STRIPE else []
    return _message(
        to=to,
        subject=f"Your Crosstune Premium renews on {day}",
        paragraphs=paragraphs,
        links=links,
    )


def withdrawal_email(*, to: str, web_origin: str, account_deleted: bool = False) -> EmailMessage:
    """Build the confirmation that a withdrawn subscription was refunded and has ended.

    Args:
        to: The address to send to.
        web_origin: The web app the catalog stays in.
        account_deleted: The refund came with an account deletion, so no catalog is left.
    """
    paragraphs = [
        "Your first payment was refunded in full, and Premium has ended.",
        "The refund reaches your card in 5 to 10 business days.",
    ]
    if account_deleted:
        paragraphs.append("Your Crosstune account and its data were deleted.")
        links: list[str] = []
    else:
        origin = web_origin.rstrip("/")
        paragraphs.append(f"Your tune catalog stays in your account at {origin}.")
        links = [origin]
    return _message(
        to=to,
        subject="Your Crosstune Premium refund",
        paragraphs=paragraphs,
        links=links,
    )
