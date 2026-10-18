"""Stripe REST client: cancels subscriptions and refunds a subscription's first payment."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import quote

from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, SUCCESS_STATUSES, send_bearer

if TYPE_CHECKING:
    import httpx2

DEFAULT_BASE_URL = "https://api.stripe.com/v1"
TERMINAL_STATUSES = frozenset({"canceled", "incomplete_expired"})
BAD_REQUEST_STATUS = 400
ITEM_PREFIX = "si_"
# The first version whose invoices expose payments through /invoice_payments, not payment_intent.
STRIPE_API_VERSION = "2025-03-31.basil"
FAILED_REFUND_STATUSES = frozenset({"failed", "canceled"})
ALREADY_REFUNDED = "charge_already_refunded"


class StripeUnavailableError(Exception):
    """Stripe did not confirm the request: a transport failure, an unexpected status, or no data."""


class StripeSubscriptions(Protocol):
    """What account deletion and withdrawal need from Stripe, held on `app.state` so tests can fake it."""

    async def cancel(self, store_id: str) -> None:
        """Cancel the subscription now, without refund. One already ended counts as cancelled."""
        ...

    async def first_payment_intent(self, store_id: str) -> str:
        """The payment intent that paid the subscription's oldest invoice.

        Raises:
            StripeUnavailableError: Stripe failed or no paid payment was found.
        """
        ...

    async def refund(self, payment_intent: str, *, idempotency_key: str) -> None:
        """Refund the payment in full. One already refunded counts as done.

        Raises:
            StripeUnavailableError: Stripe did not confirm the refund.
        """
        ...


class StripeRest:
    """Cancels subscriptions and refunds payments through Stripe's REST API."""

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

    async def first_payment_intent(self, store_id: str) -> str:
        """Find the payment intent that paid the subscription's oldest invoice that charged.

        An invoice for nothing, as a free trial or a full discount opens with, is passed over,
        since it has no payment to refund.

        Raises:
            StripeUnavailableError: A transport failure, a refusal (Stripe's message is kept, as
                it names a missing key permission), or no paid payment on the oldest invoice.
        """
        subscription_id = await self._subscription_of(store_id)
        invoices = await self._list(
            f"{self._base_url}/invoices?subscription={quote(subscription_id, safe='')}&limit=100",
            whole=True,
        )
        datable = [
            i
            for i in invoices
            if isinstance(i.get("id"), str)
            and _is_int(i.get("created"))
            and i.get("amount_paid") != 0
        ]
        if not datable:
            msg = f"Stripe lists no dated invoice that charged for {subscription_id}"
            raise StripeUnavailableError(msg)
        oldest = min(datable, key=lambda i: i["created"])
        payments = await self._list(
            f"{self._base_url}/invoice_payments?invoice={quote(oldest['id'], safe='')}&status=paid"
        )
        for item in payments:
            payment = item.get("payment")
            if not isinstance(payment, dict) or payment.get("type") != "payment_intent":
                continue
            intent = payment.get("payment_intent")
            if isinstance(intent, str) and intent:
                return intent
        msg = f"Stripe shows no paid payment on invoice {oldest['id']}"
        raise StripeUnavailableError(msg)

    async def refund(self, payment_intent: str, *, idempotency_key: str) -> None:
        """Refund the payment in full, treating an already refunded payment as done.

        Raises:
            StripeUnavailableError: A transport failure or any refusal but "already refunded".
        """
        response = await self._send(
            "POST",
            f"{self._base_url}/refunds",
            data={"payment_intent": payment_intent, "reason": "requested_by_customer"},
            headers={"Idempotency-Key": idempotency_key},
        )
        if response.status_code in SUCCESS_STATUSES:
            if _field(response, "status") in FAILED_REFUND_STATUSES:
                msg = (
                    f"Stripe reports the refund of {payment_intent} as {_field(response, 'status')}"
                )
                raise StripeUnavailableError(msg)
            return
        if response.status_code == BAD_REQUEST_STATUS and _error_code(response) == ALREADY_REFUNDED:
            return
        raise StripeUnavailableError(_refusal(f"refunding {payment_intent}", response))

    async def _list(self, url: str, *, whole: bool = False) -> list[dict[str, Any]]:
        """Read one page of a list. With `whole`, a page that leaves items behind raises.

        Stripe lists newest first, so a truncated page cannot be trusted to hold the oldest.
        """
        response = await self._send("GET", url)
        data = _field(response, "data") if response.status_code in SUCCESS_STATUSES else None
        if not isinstance(data, list):
            raise StripeUnavailableError(_refusal("listing", response))
        if whole and _field(response, "has_more") is True:
            msg = f"Stripe answered more than one page listing {url}"
            raise StripeUnavailableError(msg)
        return [item for item in data if isinstance(item, dict)]

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
        self,
        method: str,
        url: str,
        data: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
    ) -> httpx2.Response:
        return await send_bearer(
            self._client,
            method,
            url,
            token=self._secret_key,
            timeout=self._timeout,
            unavailable=StripeUnavailableError,
            data=data,
            headers={"Stripe-Version": STRIPE_API_VERSION, **(headers or {})},
        )


def _field(response: httpx2.Response, name: str) -> Any:
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get(name) if isinstance(body, dict) else None


def _error_code(response: httpx2.Response) -> Any:
    error = _field(response, "error")
    return error.get("code") if isinstance(error, dict) else None


def _refusal(action: str, response: httpx2.Response) -> str:
    error = _field(response, "error")
    message = error.get("message") if isinstance(error, dict) else None
    detail = f": {message}" if isinstance(message, str) and message else ""
    return f"Stripe answered {response.status_code} {action}{detail}"


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)
