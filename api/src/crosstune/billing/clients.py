"""Builders for the outbound billing and mail clients, shared by the API and operator commands."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.billing.revenuecat import RevenueCatRest
from crosstune.billing.stripe import StripeRest
from crosstune.email.resend import ResendMailer

if TYPE_CHECKING:
    import httpx2

    from crosstune.config import Settings


def make_revenuecat(http_client: httpx2.AsyncClient, settings: Settings) -> RevenueCatRest | None:
    """The RevenueCat client, or None when it is not configured."""
    if not settings.revenuecat_configured:
        return None
    return RevenueCatRest(
        http_client,
        settings.revenuecat_project_id,
        settings.revenuecat_secret_key.get_secret_value(),
    )


def make_stripe(http_client: httpx2.AsyncClient, settings: Settings) -> StripeRest | None:
    """The Stripe client, or None when it is not configured."""
    if not settings.stripe_configured:
        return None
    return StripeRest(http_client, settings.stripe_cancel_key.get_secret_value())


def make_mailer(http_client: httpx2.AsyncClient, settings: Settings) -> ResendMailer | None:
    """The Resend mailer, or None when mail is not configured."""
    if not settings.mail_configured:
        return None
    return ResendMailer(
        http_client, settings.resend_api_key.get_secret_value(), settings.email_from
    )
