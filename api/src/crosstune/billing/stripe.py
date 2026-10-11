"""Stripe REST client, for cancelling a subscription when its account is deleted."""

from __future__ import annotations

from typing import Any, Protocol
from urllib.parse import quote

import httpx2

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, NOT_FOUND_STATUS, SUCCESS_STATUSES

DEFAULT_BASE_URL = "https://api.stripe.com/v1"
TERMINAL_STATUSES = frozenset({"canceled", "incomplete_expired"})


class StripeUnavailableError(Exception):
    """Stripe did not confirm the cancellation: a transport failure or an unexpected status."""


class StripeSubscriptions(Protocol):
    """What account deletion needs from Stripe, held on `app.state` so tests can fake it."""

    async def cancel(self, subscription_id: str) -> None:
        """Cancel the subscription now, without refund. One already gone counts as cancelled."""
        ...


class StripeRest:
    """Cancels subscriptions through Stripe's REST API."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        secret_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._secret_key = secret_key
        self._base_url = base_url
        self._timeout = timeout

    async def cancel(self, subscription_id: str) -> None:
        """Cancel the subscription immediately, with no proration and no final invoice.

        A refused cancel counts when the subscription already reads as ended (canceled or
        incomplete_expired), since Stripe does not document what cancelling an ended
        subscription answers.

        Raises:
            StripeUnavailableError: A transport failure, or a refusal for a subscription that
                has not ended.
        """
        url = f"{self._base_url}/subscriptions/{quote(subscription_id, safe='')}"
        response = await self._send(
            "DELETE", url, data={"prorate": "false", "invoice_now": "false"}
        )
        if response.status_code in SUCCESS_STATUSES or response.status_code == NOT_FOUND_STATUS:
            return
        current = await self._send("GET", url)
        if current.status_code in SUCCESS_STATUSES and _status(current) in TERMINAL_STATUSES:
            return
        msg = f"Stripe answered {response.status_code} cancelling {subscription_id}"
        raise StripeUnavailableError(msg)

    async def _send(
        self, method: str, url: str, data: dict[str, str] | None = None
    ) -> httpx2.Response:
        try:
            return await self._client.request(
                method,
                url,
                data=data,
                headers={"Authorization": f"Bearer {self._secret_key}"},
                timeout=self._timeout,
                # A redirect would replay the bearer header against whatever it names.
                follow_redirects=False,
            )
        except httpx2.HTTPError as exc:
            raise StripeUnavailableError from exc


def _status(response: httpx2.Response) -> Any:
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("status") if isinstance(body, dict) else None
