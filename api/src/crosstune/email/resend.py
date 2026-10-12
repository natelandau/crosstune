"""Resend client for sending transactional email."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx2

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, SUCCESS_STATUSES

DEFAULT_BASE_URL = "https://api.resend.com"
HTTP_TOO_MANY_REQUESTS = 429


@dataclass(frozen=True)
class EmailMessage:
    """One email to one recipient, with both a plain-text and an HTML body."""

    to: str
    subject: str
    text: str
    html: str


class MailerUnavailableError(Exception):
    """Resend did not accept the message: a non-2xx, no message id, or a transport failure."""


class MailerRateLimitedError(MailerUnavailableError):
    """Resend answered 429: the team's rate limit or the plan's sending quota is spent."""


class Mailer(Protocol):
    """What sending email needs, held on `app.state` so tests can fake it."""

    async def send(self, message: EmailMessage, *, idempotency_key: str) -> None:
        """Send the message, raising `MailerUnavailableError` unless it was accepted."""
        ...


class ResendMailer:
    """Sends email through Resend's REST API."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        api_key: str,
        sender: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._api_key = api_key
        self._sender = sender
        self._base_url = base_url
        self._timeout = timeout

    async def send(self, message: EmailMessage, *, idempotency_key: str) -> None:
        """Send the message once.

        Resend keeps an idempotency key for 24 hours, so a caller that retries with the
        same key and body cannot send the message twice. This method does not retry.

        Raises:
            MailerRateLimitedError: Resend answered 429.
            MailerUnavailableError: Resend answered with anything but a 2xx carrying the
                new message's id, or the request itself failed (a timeout, a closed
                connection, and so on).
        """
        try:
            response = await self._client.post(
                f"{self._base_url}/emails",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Idempotency-Key": idempotency_key,
                },
                json={
                    "from": self._sender,
                    "to": [message.to],
                    "subject": message.subject,
                    "text": message.text,
                    "html": message.html,
                },
                timeout=self._timeout,
                # The shared client follows redirects for link resolution; a redirect
                # here would replay the bearer header elsewhere or read as a sent email.
                follow_redirects=False,
            )
        except httpx2.HTTPError as exc:
            raise MailerUnavailableError from exc
        if response.status_code == HTTP_TOO_MANY_REQUESTS:
            msg = "Resend answered 429 sending an email"
            raise MailerRateLimitedError(msg)
        if response.status_code not in SUCCESS_STATUSES:
            msg = f"Resend answered {response.status_code} sending an email"
            raise MailerUnavailableError(msg)
        # Callers treat a send as accepted only on Resend's own receipt, the message id.
        try:
            body = response.json()
        except ValueError:
            body = None
        message_id = body.get("id") if isinstance(body, dict) else None
        if not isinstance(message_id, str) or not message_id:
            msg = f"Resend answered {response.status_code} without a message id"
            raise MailerUnavailableError(msg)
