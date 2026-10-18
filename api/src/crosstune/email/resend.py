"""Resend client for sending transactional email."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, SUCCESS_STATUSES, send_bearer

if TYPE_CHECKING:
    import httpx2

DEFAULT_BASE_URL = "https://api.resend.com"
HTTP_TOO_MANY_REQUESTS = 429
MAX_BATCH_SIZE = 100


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

    async def send_batch(self, messages: list[EmailMessage], *, idempotency_key: str) -> None:
        """Send up to `MAX_BATCH_SIZE` messages in one request, all or none accepted."""
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
        response = await self._post("/emails", self._payload(message), idempotency_key)
        # Callers treat a send as accepted only on Resend's own receipt, the message id.
        try:
            body = response.json()
        except ValueError:
            body = None
        message_id = body.get("id") if isinstance(body, dict) else None
        if not isinstance(message_id, str) or not message_id:
            msg = f"Resend answered {response.status_code} without a message id"
            raise MailerUnavailableError(msg)

    async def send_batch(self, messages: list[EmailMessage], *, idempotency_key: str) -> None:
        """Send up to `MAX_BATCH_SIZE` messages in one request.

        Resend validates the whole batch before sending any of it, and the idempotency key
        makes a retry of the same batch safe. This method does not retry.

        Raises:
            ValueError: There are more than `MAX_BATCH_SIZE` messages.
            MailerRateLimitedError: Resend answered 429.
            MailerUnavailableError: Resend answered with anything but a 2xx carrying one
                message id per message, or the request itself failed.
        """
        if len(messages) > MAX_BATCH_SIZE:
            msg = f"Resend takes at most {MAX_BATCH_SIZE} emails per batch, got {len(messages)}"
            raise ValueError(msg)
        response = await self._post(
            "/emails/batch", [self._payload(message) for message in messages], idempotency_key
        )
        try:
            body = response.json()
        except ValueError:
            body = None
        accepted = body.get("data") if isinstance(body, dict) else None
        if (
            not isinstance(accepted, list)
            or len(accepted) != len(messages)
            or not all(
                isinstance(item, dict) and isinstance(item.get("id"), str) and item["id"]
                for item in accepted
            )
        ):
            msg = f"Resend answered {response.status_code} without an id for every email"
            raise MailerUnavailableError(msg)

    def _payload(self, message: EmailMessage) -> dict[str, object]:
        return {
            "from": self._sender,
            "to": [message.to],
            "subject": message.subject,
            "text": message.text,
            "html": message.html,
        }

    async def _post(
        self, path: str, payload: dict[str, object] | list[dict[str, object]], idempotency_key: str
    ) -> httpx2.Response:
        response = await send_bearer(
            self._client,
            "POST",
            f"{self._base_url}{path}",
            token=self._api_key,
            timeout=self._timeout,
            unavailable=MailerUnavailableError,
            headers={"Idempotency-Key": idempotency_key},
            json=payload,
        )
        if response.status_code == HTTP_TOO_MANY_REQUESTS:
            msg = f"Resend answered 429 on {path}"
            raise MailerRateLimitedError(msg)
        if response.status_code not in SUCCESS_STATUSES:
            msg = f"Resend answered {response.status_code} on {path}"
            raise MailerUnavailableError(msg)
        return response
