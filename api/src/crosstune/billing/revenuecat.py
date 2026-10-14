"""RevenueCat REST API v2 client, mapping a customer's subscriptions into paid grants."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Protocol
from urllib.parse import parse_qs, quote, urlsplit

from crosstune.billing.grants import PaidSubscription
from crosstune.rest import DEFAULT_TIMEOUT_SECONDS, NOT_FOUND_STATUS, SUCCESS_STATUSES, send_bearer
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource

if TYPE_CHECKING:
    import httpx2

PREMIUM_ENTITLEMENT = "premium"
DEFAULT_BASE_URL = "https://api.revenuecat.com/v2"

_SOURCES = {
    "app_store": GrantSource.APPLE,
    "mac_app_store": GrantSource.APPLE,
    "stripe": GrantSource.STRIPE,
}
_RENEWING = {"will_renew", "will_change_product", "has_already_renewed"}


class RevenueCatUnavailableError(Exception):
    """RevenueCat did not give a usable answer: a transport failure or an unexpected status."""


class RevenueCat(Protocol):
    """What the billing sync needs from RevenueCat, held on `app.state` so tests can fake it."""

    async def subscriptions(
        self, customer_id: str, *, now: datetime | None = None
    ) -> list[PaidSubscription]:
        """The customer's premium subscriptions, judged at `now`. An unknown customer has none."""
        ...

    async def delete_customer(self, customer_id: str) -> None:
        """Delete the customer. One already gone counts as deleted."""
        ...


class RevenueCatRest:
    """Reads subscriptions and deletes customers through RevenueCat's REST API v2."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        project_id: str,
        secret_key: str,
        *,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._secret_key = secret_key
        self._timeout = timeout
        self._customers_url = f"{base_url}/projects/{quote(project_id, safe='')}/customers"

    async def subscriptions(
        self, customer_id: str, *, now: datetime | None = None
    ) -> list[PaidSubscription]:
        """Map the customer's subscriptions that carry the premium entitlement.

        Pass the caller's `now`, so an expiry capped at now never lands after the instant the
        caller judges it against.

        Raises:
            RevenueCatUnavailableError: A transport failure, any status but 2xx or a 404 on
                the customer, or pages that do not end.
        """
        url = f"{self._customers_url}/{quote(customer_id, safe='')}"
        response = await self._request("GET", url, missing_ok=True)
        if response.status_code == NOT_FOUND_STATUS:
            return []
        customer = _json(response)
        active = {
            item.get("entitlement_id"): item.get("expires_at")
            for item in (customer.get("active_entitlements") or {}).get("items") or []
        }

        now = now or datetime.now(UTC)
        subscriptions: list[PaidSubscription] = []
        params: dict[str, str] = {}
        seen: set[str] = set()
        while True:
            # Once the customer exists, a missing page is a failed read, never "no subscriptions",
            # which would end every paid grant.
            page = _json(await self._request("GET", f"{url}/subscriptions", params))
            for item in page.get("items") or []:
                mapped = _map_subscription(item, active, now)
                if mapped is not None:
                    subscriptions.append(mapped)
            cursor = _cursor(page.get("next_page"))
            if cursor is None:
                return subscriptions
            if cursor in seen:
                msg = "RevenueCat sent a page cursor it had already sent"
                raise RevenueCatUnavailableError(msg)
            seen.add(cursor)
            params = {"starting_after": cursor}

    async def delete_customer(self, customer_id: str) -> None:
        """Delete the customer, whose subscriptions and entitlements go with it.

        Raises:
            RevenueCatUnavailableError: A transport failure, or any status but 2xx or 404.
        """
        await self._request(
            "DELETE", f"{self._customers_url}/{quote(customer_id, safe='')}", missing_ok=True
        )

    async def _request(
        self,
        method: str,
        url: str,
        params: dict[str, str] | None = None,
        *,
        missing_ok: bool = False,
    ) -> httpx2.Response:
        """Send one request, raising on any status but 2xx, or a 404 when `missing_ok`."""
        response = await send_bearer(
            self._client,
            method,
            url,
            token=self._secret_key,
            timeout=self._timeout,
            unavailable=RevenueCatUnavailableError,
            params=params,
        )
        if response.status_code not in SUCCESS_STATUSES and not (
            missing_ok and response.status_code == NOT_FOUND_STATUS
        ):
            msg = f"RevenueCat answered {response.status_code} to {method} {urlsplit(url).path}"
            raise RevenueCatUnavailableError(msg)
        return response


def _json(response: httpx2.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError as exc:
        msg = "RevenueCat sent a body that is not JSON"
        raise RevenueCatUnavailableError(msg) from exc
    if not isinstance(body, dict):
        msg = "RevenueCat sent an unexpected payload"
        raise RevenueCatUnavailableError(msg)
    return body


def _cursor(next_page: Any) -> str | None:
    """The `starting_after` cursor of a `next_page` link, which is never followed as sent."""
    if not isinstance(next_page, str) or not next_page:
        return None
    values = parse_qs(urlsplit(next_page).query).get("starting_after")
    if not values:
        msg = "RevenueCat sent a next page without a cursor"
        raise RevenueCatUnavailableError(msg)
    return values[0]


def _from_ms(value: object) -> datetime | None:
    if not isinstance(value, int | float) or isinstance(value, bool):
        return None
    return datetime.fromtimestamp(value / 1000, UTC)


def _map_subscription(
    item: dict[str, Any], active: dict[object, object], now: datetime
) -> PaidSubscription | None:
    """Map one subscription, or None when it is not a premium one from a store we mirror."""
    source = _SOURCES.get(item.get("store"))
    environment = item.get("environment")
    subscription_id = item.get("id")
    store_id = item.get("store_subscription_identifier")
    if (
        source is None
        or environment not in {e.value for e in GrantEnvironment}
        or subscription_id in (None, "")
        or store_id in (None, "")
    ):
        return None
    # The customer's active entitlements name an entitlement by id, not by lookup key.
    premium_ids = [
        entitlement.get("id")
        for entitlement in (item.get("entitlements") or {}).get("items") or []
        if entitlement.get("lookup_key") == PREMIUM_ENTITLEMENT
    ]
    if not premium_ids:
        return None

    period_end = _from_ms(item.get("current_period_ends_at"))
    if item.get("gives_access"):
        if period_end is not None and period_end > now:
            expires_at = period_end
        else:
            # Apple's grace period and Stripe's retries keep access past the period end.
            held = [eid for eid in premium_ids if eid in active]
            if not held:
                # Access with no end date the customer's entitlements back must not become perpetual.
                expires_at = now
            elif any(active[eid] is None for eid in held):
                # RevenueCat reports an entitlement with no expiry as never expiring.
                expires_at = None
            else:
                expires_at = max(_from_ms(active[eid]) or now for eid in held)
    else:
        ended = _from_ms(item.get("ends_at")) or period_end
        expires_at = min(ended, now) if ended else now

    return PaidSubscription(
        subscription_id=str(subscription_id),
        store_id=str(store_id),
        source=source,
        kind=GrantKind.PREMIUM,
        environment=GrantEnvironment(environment),
        expires_at=expires_at,
        auto_renews=item.get("auto_renewal_status") in _RENEWING,
    )
