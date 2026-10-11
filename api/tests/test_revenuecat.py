"""RevenueCat REST client mapping, pagination, and failure handling."""

import json
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx2
import pytest

from crosstune.billing.grants import PaidSubscription
from crosstune.billing.revenuecat import RevenueCatRest, RevenueCatUnavailableError
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource

FIXTURES = Path(__file__).parent / "fixtures" / "revenuecat"
BASE = "https://rc.example.test/v2"
CUSTOMER_URL = f"{BASE}/projects/proj_1/customers/cust_1"
SUBS_URL = f"{CUSTOMER_URL}/subscriptions"
KEY = "sk_rc_fixture"  # gitleaks:allow -- fixture, not a credential

pytestmark = pytest.mark.anyio


def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _ms(moment: datetime) -> int:
    return int(moment.timestamp() * 1000)


def _client(mock_http) -> RevenueCatRest:
    return RevenueCatRest(mock_http.client(), "proj_1", KEY, base_url=BASE)


def _serve(mock_http, subscriptions: dict, customer: dict | None = None) -> None:
    mock_http.add(SUBS_URL, httpx2.Response(200, json=subscriptions))
    mock_http.add(CUSTOMER_URL, httpx2.Response(200, json=customer or _load("customer.json")))


def _by_id(subs: list[PaidSubscription]) -> dict[str, PaidSubscription]:
    return {sub.store_id: sub for sub in subs}


async def test_maps_active_stripe_subscription(mock_http) -> None:
    _serve(mock_http, _load("subscriptions.json"))

    subs = _by_id(await _client(mock_http).subscriptions("cust_1"))

    assert subs["sub_1StripeActive"] == PaidSubscription(
        store_id="sub_1StripeActive",
        source=GrantSource.STRIPE,
        kind=GrantKind.PREMIUM,
        environment=GrantEnvironment.PRODUCTION,
        expires_at=datetime(2099, 1, 1, tzinfo=UTC),
        auto_renews=True,
    )


async def test_maps_apple_grace_to_entitlement_expiry(mock_http) -> None:
    _serve(mock_http, _load("subscriptions_grace.json"))

    [sub] = await _client(mock_http).subscriptions("cust_1")

    assert sub.source is GrantSource.APPLE
    assert sub.environment is GrantEnvironment.SANDBOX
    assert sub.store_id == "2000000123456789"
    # The premium entitlement, not the add-on that expires earlier.
    assert sub.expires_at == datetime(2099, 1, 1, tzinfo=UTC)


async def test_maps_expired_subscription_capped_at_now(mock_http) -> None:
    payload = _load("subscriptions.json")
    expired = payload["items"][2]
    _serve(mock_http, payload)

    subs = _by_id(await _client(mock_http).subscriptions("cust_1"))

    assert subs["sub_1StripeExpired"].expires_at == datetime(2020, 3, 1, tzinfo=UTC)
    assert subs["sub_1StripeExpired"].auto_renews is False

    expired["ends_at"] = _ms(datetime.now(UTC) + timedelta(days=30))
    expired["current_period_ends_at"] = None
    _serve(mock_http, payload)
    capped = _by_id(await _client(mock_http).subscriptions("cust_1"))["sub_1StripeExpired"]
    assert capped.expires_at is not None
    assert capped.expires_at <= datetime.now(UTC)


async def test_skips_subscriptions_without_premium(mock_http) -> None:
    payload = _load("subscriptions.json")
    payload["items"][0]["entitlements"]["items"][0]["lookup_key"] = "storage_addon"
    payload["items"][1]["store"] = "play_store"
    _serve(mock_http, payload)

    subs = await _client(mock_http).subscriptions("cust_1")

    assert [sub.store_id for sub in subs] == ["sub_1StripeExpired"]


async def test_reads_every_page(mock_http) -> None:
    payload = _load("subscriptions.json")
    first = {
        **payload,
        "items": payload["items"][:1],
        "next_page": "/v2/x?starting_after=sub_active",
    }
    second = {**payload, "items": payload["items"][1:2], "next_page": None}
    mock_http.add(f"{SUBS_URL}?starting_after=sub_active", httpx2.Response(200, json=second))
    _serve(mock_http, first)

    subs = await _client(mock_http).subscriptions("cust_1")

    assert [sub.store_id for sub in subs] == ["sub_1StripeActive", "2000000123456789"]


async def test_missing_customer_is_empty(mock_http) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(404, json={"type": "resource_missing"}))

    assert await _client(mock_http).subscriptions("cust_1") == []


async def test_missing_subscription_list_of_a_known_customer_raises(mock_http) -> None:
    mock_http.add(SUBS_URL, httpx2.Response(404, json={"type": "resource_missing"}))
    mock_http.add(CUSTOMER_URL, httpx2.Response(200, json=_load("customer.json")))

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_missing_later_page_raises(mock_http) -> None:
    payload = _load("subscriptions.json")
    first = {**payload, "next_page": "/v2/x?starting_after=sub_active"}
    mock_http.add(f"{SUBS_URL}?starting_after=sub_active", httpx2.Response(404))
    _serve(mock_http, first)

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_repeated_cursor_raises(mock_http) -> None:
    payload = _load("subscriptions.json")
    looping = {**payload, "next_page": "/v2/x?starting_after=sub_active"}
    mock_http.add(f"{SUBS_URL}?starting_after=sub_active", httpx2.Response(200, json=looping))
    _serve(mock_http, looping)

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_next_page_without_cursor_raises(mock_http) -> None:
    _serve(mock_http, {**_load("subscriptions.json"), "next_page": "/v2/x?limit=20"})

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_non_json_body_raises(mock_http) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(200, text="<html>"))

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_maps_mac_app_store_to_apple(mock_http) -> None:
    payload = _load("subscriptions_grace.json")
    payload["items"][0]["store"] = "mac_app_store"
    _serve(mock_http, payload)

    [sub] = await _client(mock_http).subscriptions("cust_1")

    assert sub.source is GrantSource.APPLE


@pytest.mark.parametrize("status", ["will_change_product", "has_already_renewed"])
async def test_renewing_statuses_auto_renew(mock_http, status: str) -> None:
    payload = _load("subscriptions_grace.json")
    payload["items"][0]["auto_renewal_status"] = status
    _serve(mock_http, payload)

    [sub] = await _client(mock_http).subscriptions("cust_1")

    assert sub.auto_renews is True


@pytest.mark.parametrize("status", [429, 500, 503])
async def test_server_error_raises_unavailable(mock_http, status: int) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(status))

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")


async def test_transport_error_raises_unavailable() -> None:
    def boom(request: httpx2.Request) -> httpx2.Response:
        msg = "down"
        raise httpx2.ConnectError(msg, request=request)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(boom))

    with pytest.raises(RevenueCatUnavailableError):
        await RevenueCatRest(client, "proj_1", KEY, base_url=BASE).subscriptions("cust_1")


async def test_sends_bearer_and_no_redirects(mock_http) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(302, headers={"Location": "https://evil.test/"}))

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).subscriptions("cust_1")

    [call] = mock_http.calls
    assert call.headers["Authorization"] == f"Bearer {KEY}"


@pytest.mark.parametrize("status", [200, 404])
async def test_delete_customer_accepts_404(mock_http, status: int) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(status, json={}))

    await _client(mock_http).delete_customer("cust_1")

    assert mock_http.calls[0].method == "DELETE"


async def test_delete_customer_raises_on_error(mock_http) -> None:
    mock_http.add(CUSTOMER_URL, httpx2.Response(500))

    with pytest.raises(RevenueCatUnavailableError):
        await _client(mock_http).delete_customer("cust_1")


async def test_access_without_expiry_or_entitlement_fails_closed(mock_http) -> None:
    payload = _load("subscriptions_grace.json")
    payload["items"][0]["current_period_ends_at"] = None
    customer = _load("customer.json")
    customer["active_entitlements"]["items"] = []
    _serve(mock_http, payload, customer)

    before = datetime.now(UTC)
    [sub] = await _client(mock_http).subscriptions("cust_1")
    after = datetime.now(UTC)

    assert sub.expires_at is not None
    assert before <= sub.expires_at <= after


async def test_capped_access_ends_at_the_callers_now(mock_http) -> None:
    payload = _load("subscriptions_grace.json")
    payload["items"][0]["current_period_ends_at"] = None
    customer = _load("customer.json")
    customer["active_entitlements"]["items"] = []
    _serve(mock_http, payload, customer)
    now = datetime.now(UTC) - timedelta(minutes=5)

    [sub] = await _client(mock_http).subscriptions("cust_1", now=now)

    assert sub.expires_at == now


async def test_access_held_only_by_another_entitlement_fails_closed(mock_http) -> None:
    payload = _load("subscriptions_grace.json")
    payload["items"][0]["current_period_ends_at"] = None
    customer = _load("customer.json")
    # Only the add-on's entitlement is active, not the subscription's premium one.
    customer["active_entitlements"]["items"] = customer["active_entitlements"]["items"][1:]
    _serve(mock_http, payload, customer)

    before = datetime.now(UTC)
    [sub] = await _client(mock_http).subscriptions("cust_1")
    after = datetime.now(UTC)

    assert sub.expires_at is not None
    assert before <= sub.expires_at <= after


async def test_entitlement_without_expiry_never_expires(mock_http) -> None:
    customer = _load("customer.json")
    customer["active_entitlements"]["items"][0]["expires_at"] = None
    _serve(mock_http, _load("subscriptions_grace.json"), customer)

    [sub] = await _client(mock_http).subscriptions("cust_1")

    assert sub.expires_at is None
