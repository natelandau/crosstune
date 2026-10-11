"""Stripe REST client subscription cancellation."""

import httpx2
import pytest

from crosstune.billing.stripe import StripeRest, StripeUnavailableError

BASE = "https://stripe.example.test/v1"
KEY = "sk_test_fixture"  # gitleaks:allow -- fixture, not a credential
URL = f"{BASE}/subscriptions/sub_1"

pytestmark = pytest.mark.anyio


async def test_cancel_sends_no_proration(mock_http) -> None:
    mock_http.add(URL, httpx2.Response(200, json={"id": "sub_1", "status": "canceled"}))

    await StripeRest(mock_http.client(), KEY, base_url=BASE).cancel("sub_1")

    [call] = mock_http.calls
    assert call.method == "DELETE"
    assert call.headers["Authorization"] == f"Bearer {KEY}"
    assert call.content == b"prorate=false&invoice_now=false"


async def test_cancel_accepts_missing(mock_http) -> None:
    mock_http.add(URL, httpx2.Response(404, json={"error": {"code": "resource_missing"}}))

    await StripeRest(mock_http.client(), KEY, base_url=BASE).cancel("sub_1")


def _by_method(
    responses: dict[str, httpx2.Response], calls: list[httpx2.Request]
) -> httpx2.AsyncClient:
    def handle(request: httpx2.Request) -> httpx2.Response:
        calls.append(request)
        return responses[request.method]

    return httpx2.AsyncClient(transport=httpx2.MockTransport(handle), follow_redirects=True)


@pytest.mark.parametrize("status", [302, 400, 401, 429, 500])
async def test_cancel_raises_on_error(status: int) -> None:
    calls: list[httpx2.Request] = []
    refused = httpx2.Response(status, headers={"Location": "https://evil.test/"})
    client = _by_method({"DELETE": refused, "GET": refused}, calls)

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")

    assert all(call.url.host == "stripe.example.test" for call in calls)


async def test_cancel_of_an_already_cancelled_subscription_succeeds() -> None:
    calls: list[httpx2.Request] = []
    client = _by_method(
        {
            "DELETE": httpx2.Response(400, json={"error": {"code": "resource_invalid"}}),
            "GET": httpx2.Response(200, json={"id": "sub_1", "status": "canceled"}),
        },
        calls,
    )

    await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")

    assert [(call.method, str(call.url)) for call in calls] == [("DELETE", URL), ("GET", URL)]
    assert calls[1].headers["Authorization"] == f"Bearer {KEY}"


async def test_cancel_of_an_expired_incomplete_subscription_succeeds() -> None:
    calls: list[httpx2.Request] = []
    client = _by_method(
        {
            "DELETE": httpx2.Response(400, json={"error": {"code": "resource_invalid"}}),
            "GET": httpx2.Response(200, json={"id": "sub_1", "status": "incomplete_expired"}),
        },
        calls,
    )

    await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")

    assert [(call.method, str(call.url)) for call in calls] == [("DELETE", URL), ("GET", URL)]
    assert calls[1].headers["Authorization"] == f"Bearer {KEY}"


async def test_cancel_refused_for_a_live_subscription_raises() -> None:
    client = _by_method(
        {
            "DELETE": httpx2.Response(400),
            "GET": httpx2.Response(200, json={"id": "sub_1", "status": "active"}),
        },
        [],
    )

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")


async def test_cancel_raises_when_the_status_read_fails() -> None:
    def handle(request: httpx2.Request) -> httpx2.Response:
        if request.method == "GET":
            msg = "down"
            raise httpx2.ConnectError(msg, request=request)
        return httpx2.Response(400)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(handle))

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")


async def test_cancel_raises_when_the_status_read_is_not_json() -> None:
    client = _by_method(
        {"DELETE": httpx2.Response(400), "GET": httpx2.Response(200, text="<html>")}, []
    )

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")


async def test_cancel_raises_on_transport_error() -> None:
    def boom(request: httpx2.Request) -> httpx2.Response:
        msg = "down"
        raise httpx2.ConnectError(msg, request=request)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(boom))

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")
