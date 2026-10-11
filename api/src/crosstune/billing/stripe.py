"""Stripe REST client, for cancelling a subscription when its account is deleted."""

from __future__ import annotations

from typing import Any, Protocol
from urllib.parse import quote

import httpx2

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, SUCCESS_STATUSES

DEFAULT_BASE_URL = "https://api.stripe.com/v1"
TERMINAL_STATUSES = frozenset({"canceled", "incomplete_expired"})
ITEM_PREFIX = "si_"


class StripeUnavailableError(Exception):
    """Stripe did not confirm the cancellation: a transport failure or an unexpected status."""


class StripeSubscriptions(Protocol):
    """What account deletion needs from Stripe, held on `app.state` so tests can fake it."""

    async def cancel(self, store_id: str) -> None:
        """Cancel the subscription now, without refund. One already ended counts as cancelled."""
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

    async def cancel(self, store_id: str) -> None:
        """Cancel the subscription immediately, with no proration and no final invoice.

        `store_id` is RevenueCat's identifier for the subscription, which for Stripe Billing is
        the subscription's item, so an item ID is first resolved to its subscription.

        A refused cancel counts only when the subscription reads as ended (canceled or
        incomplete_expired), since Stripe does not document what cancelling an ended
        subscription answers. Anything else, a 404 included, raises: a wrong ID must never pass
        for a cancelled subscription that goes on billing.

        Raises:
            StripeUnavailableError: A transport failure, an item that names no subscription, or
                a refusal for a subscription that has not ended.
        """
        subscription_id = await self._subscription_of(store_id)
        url = f"{self._base_url}/subscriptions/{quote(subscription_id, safe='')}"
        response = await self._send(
            "DELETE", url, data={"prorate": "false", "invoice_now": "false"}
        )
        if response.status_code in SUCCESS_STATUSES:
            return
        current = await self._send("GET", url)
        if (
            current.status_code in SUCCESS_STATUSES
            and _field(current, "status") in TERMINAL_STATUSES
        ):
            return
        msg = f"Stripe answered {response.status_code} cancelling {subscription_id}"
        raise StripeUnavailableError(msg)

    async def _subscription_of(self, store_id: str) -> str:
        if not store_id.startswith(ITEM_PREFIX):
            return store_id
        url = f"{self._base_url}/subscription_items/{quote(store_id, safe='')}"
        response = await self._send("GET", url)
        subscription_id = (
            _field(response, "subscription") if response.status_code in SUCCESS_STATUSES else None
        )
        if not isinstance(subscription_id, str) or not subscription_id:
            msg = f"Stripe answered {response.status_code} reading subscription item {store_id}"
            raise StripeUnavailableError(msg)
        return subscription_id

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


def _field(response: httpx2.Response, name: str) -> Any:
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get(name) if isinstance(body, dict) else None
