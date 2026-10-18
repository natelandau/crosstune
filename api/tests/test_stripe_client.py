"""Stripe REST client: subscription cancellation, first payment lookup, and refunds."""

import httpx2
import pytest

from crosstune.billing.stripe import STRIPE_API_VERSION, StripeRest, StripeUnavailableError

BASE = "https://stripe.example.test/v1"
KEY = "sk_test_fixture"  # gitleaks:allow -- fixture, not a credential
URL = f"{BASE}/subscriptions/sub_1"
ITEM_URL = f"{BASE}/subscription_items/si_1"

pytestmark = pytest.mark.anyio


async def test_cancel_sends_no_proration(mock_http) -> None:
    mock_http.add(URL, httpx2.Response(200, json={"id": "sub_1", "status": "canceled"}))

    await StripeRest(mock_http.client(), KEY, base_url=BASE).cancel("sub_1")

    [call] = mock_http.calls
    assert call.method == "DELETE"
    assert call.headers["Authorization"] == f"Bearer {KEY}"
    assert call.content == b"prorate=false&invoice_now=false"


async def test_cancel_of_a_missing_subscription_raises() -> None:
    missing = httpx2.Response(404, json={"error": {"code": "resource_missing"}})
    client = _by_method({"DELETE": missing, "GET": missing}, [])

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("sub_1")


def _by_route(
    responses: dict[tuple[str, str], httpx2.Response], calls: list[httpx2.Request]
) -> httpx2.AsyncClient:
    def handle(request: httpx2.Request) -> httpx2.Response:
        calls.append(request)
        return responses[(request.method, str(request.url))]

    return httpx2.AsyncClient(transport=httpx2.MockTransport(handle))


async def test_cancel_resolves_an_item_to_its_subscription() -> None:
    calls: list[httpx2.Request] = []
    client = _by_route(
        {
            ("GET", ITEM_URL): httpx2.Response(
                200, json={"id": "si_1", "object": "subscription_item", "subscription": "sub_1"}
            ),
            ("DELETE", URL): httpx2.Response(200, json={"id": "sub_1", "status": "canceled"}),
        },
        calls,
    )

    await StripeRest(client, KEY, base_url=BASE).cancel("si_1")

    assert [(call.method, str(call.url)) for call in calls] == [
        ("GET", ITEM_URL),
        ("DELETE", URL),
    ]
    assert all(call.headers["Authorization"] == f"Bearer {KEY}" for call in calls)
    assert calls[1].content == b"prorate=false&invoice_now=false"


@pytest.mark.parametrize(
    "item",
    [
        httpx2.Response(404, json={"error": {"code": "resource_missing"}}),
        httpx2.Response(403, json={"error": {"type": "invalid_request_error"}}),
        httpx2.Response(200, json={"id": "si_1"}),
        httpx2.Response(200, text="<html>"),
    ],
)
async def test_cancel_raises_when_an_item_names_no_subscription(item: httpx2.Response) -> None:
    calls: list[httpx2.Request] = []
    client = _by_route({("GET", ITEM_URL): item}, calls)

    with pytest.raises(StripeUnavailableError):
        await StripeRest(client, KEY, base_url=BASE).cancel("si_1")

    assert [call.method for call in calls] == ["GET"]


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


INVOICES_URL = f"{BASE}/invoices?subscription=sub_1&limit=100"
REFUNDS_URL = f"{BASE}/refunds"


def _payments(intent: str | None) -> httpx2.Response:
    data = (
        [{"id": "inpay_1", "payment": {"type": "payment_intent", "payment_intent": intent}}]
        if intent
        else []
    )
    return httpx2.Response(200, json={"object": "list", "data": data})


async def test_first_payment_intent_picks_the_oldest_invoice(mock_http) -> None:
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(
            200,
            json={
                "data": [
                    {"id": "in_new", "created": 200},
                    {"id": "in_old", "created": 100},
                    {"id": "in_mid", "created": 150},
                ]
            },
        ),
    )
    mock_http.add(f"{BASE}/invoice_payments?invoice=in_old&status=paid", _payments("pi_1"))

    intent = await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")

    assert intent == "pi_1"
    assert [(c.method, str(c.url)) for c in mock_http.calls] == [
        ("GET", INVOICES_URL),
        ("GET", f"{BASE}/invoice_payments?invoice=in_old&status=paid"),
    ]


async def test_first_payment_intent_passes_over_an_invoice_for_nothing(mock_http) -> None:
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(
            200,
            json={
                "data": [
                    {"id": "in_paid", "created": 200, "amount_paid": 999},
                    {"id": "in_trial", "created": 100, "amount_paid": 0},
                ]
            },
        ),
    )
    mock_http.add(f"{BASE}/invoice_payments?invoice=in_paid&status=paid", _payments("pi_2"))

    intent = await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")

    assert intent == "pi_2"


async def test_first_payment_intent_resolves_an_item_first(mock_http) -> None:
    mock_http.add(ITEM_URL, httpx2.Response(200, json={"id": "si_1", "subscription": "sub_1"}))
    mock_http.add(
        f"{BASE}/invoices", httpx2.Response(200, json={"data": [{"id": "in_1", "created": 1}]})
    )
    mock_http.add(f"{BASE}/invoice_payments", _payments("pi_9"))

    intent = await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("si_1")

    assert intent == "pi_9"
    assert str(mock_http.calls[0].url) == ITEM_URL


@pytest.mark.parametrize(
    ("invoices", "payments"),
    [
        ({"data": []}, None),
        ({"data": [{"id": "in_1", "created": 1}]}, {"data": []}),
        ({"data": [{"id": "in_1", "created": 1}]}, {"data": [{"payment": {"type": "charge"}}]}),
    ],
)
async def test_first_payment_intent_raises_when_nothing_was_paid(
    mock_http, invoices: dict, payments: dict | None
) -> None:
    mock_http.add(f"{BASE}/invoices", httpx2.Response(200, json=invoices))
    mock_http.add(f"{BASE}/invoice_payments", httpx2.Response(200, json=payments or {}))

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")


async def test_first_payment_intent_keeps_stripes_message_on_a_refusal(mock_http) -> None:
    message = "The provided key does not have the required permissions: rak_invoice_read"
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(403, json={"error": {"type": "invalid_request_error", "message": message}}),
    )

    with pytest.raises(StripeUnavailableError, match="rak_invoice_read"):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")


async def test_refund_sends_the_intent_reason_and_idempotency_key(mock_http) -> None:
    mock_http.add(REFUNDS_URL, httpx2.Response(200, json={"id": "re_1", "status": "succeeded"}))

    await StripeRest(mock_http.client(), KEY, base_url=BASE).refund("pi_1", idempotency_key="key-1")

    [call] = mock_http.calls
    assert call.method == "POST"
    assert call.headers["Idempotency-Key"] == "key-1"
    assert call.content == b"payment_intent=pi_1&reason=requested_by_customer"


async def test_refund_of_an_already_refunded_payment_succeeds(mock_http) -> None:
    mock_http.add(
        REFUNDS_URL,
        httpx2.Response(400, json={"error": {"code": "charge_already_refunded"}}),
    )

    await StripeRest(mock_http.client(), KEY, base_url=BASE).refund("pi_1", idempotency_key="key-1")


@pytest.mark.parametrize(
    "refusal",
    [
        httpx2.Response(400, json={"error": {"code": "charge_disputed", "message": "Disputed"}}),
        httpx2.Response(403, json={"error": {"message": "No permission"}}),
        httpx2.Response(500, text="<html>"),
    ],
)
async def test_refund_raises_on_any_other_refusal(mock_http, refusal: httpx2.Response) -> None:
    mock_http.add(REFUNDS_URL, refusal)

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).refund(
            "pi_1", idempotency_key="key-1"
        )


async def test_every_call_pins_the_api_version(mock_http) -> None:
    mock_http.add(ITEM_URL, httpx2.Response(200, json={"subscription": "sub_1"}))
    mock_http.add(URL, httpx2.Response(200, json={"status": "canceled"}))
    mock_http.add(
        f"{BASE}/invoices", httpx2.Response(200, json={"data": [{"id": "in_1", "created": 1}]})
    )
    mock_http.add(f"{BASE}/invoice_payments", _payments("pi_1"))
    mock_http.add(REFUNDS_URL, httpx2.Response(200, json={}))
    stripe = StripeRest(mock_http.client(), KEY, base_url=BASE)

    await stripe.cancel("si_1")
    await stripe.first_payment_intent("sub_1")
    await stripe.refund("pi_1", idempotency_key="key-1")

    assert len(mock_http.calls) == 5
    assert {c.headers["Stripe-Version"] for c in mock_http.calls} == {"2025-03-31.basil"}
    assert STRIPE_API_VERSION == "2025-03-31.basil"


async def test_first_payment_intent_raises_when_invoices_span_pages(mock_http) -> None:
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(200, json={"has_more": True, "data": [{"id": "in_1", "created": 1}]}),
    )

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")

    assert len(mock_http.calls) == 1


@pytest.mark.parametrize("created", [None, "100", True, 1.5])
async def test_first_payment_intent_ignores_invoices_without_an_integer_date(
    mock_http, created: object
) -> None:
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(200, json={"data": [{"id": "in_x", "created": created}]}),
    )

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")


async def test_first_payment_intent_skips_an_undated_invoice_for_a_dated_one(mock_http) -> None:
    mock_http.add(
        f"{BASE}/invoices",
        httpx2.Response(200, json={"data": [{"id": "in_x"}, {"id": "in_1", "created": 5}]}),
    )
    mock_http.add(f"{BASE}/invoice_payments?invoice=in_1", _payments("pi_1"))

    intent = await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")

    assert intent == "pi_1"


async def test_first_payment_intent_raises_when_invoices_are_not_json(mock_http) -> None:
    mock_http.add(f"{BASE}/invoices", httpx2.Response(200, text="<html>"))

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")


@pytest.mark.parametrize("status", [403, 500])
async def test_first_payment_intent_raises_when_payments_are_refused(
    mock_http, status: int
) -> None:
    mock_http.add(
        f"{BASE}/invoices", httpx2.Response(200, json={"data": [{"id": "in_1", "created": 1}]})
    )
    mock_http.add(
        f"{BASE}/invoice_payments", httpx2.Response(status, json={"error": {"message": "no"}})
    )

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).first_payment_intent("sub_1")


@pytest.mark.parametrize("status", ["failed", "canceled"])
async def test_refund_raises_when_stripe_reports_it_failed(mock_http, status: str) -> None:
    mock_http.add(REFUNDS_URL, httpx2.Response(200, json={"id": "re_1", "status": status}))

    with pytest.raises(StripeUnavailableError):
        await StripeRest(mock_http.client(), KEY, base_url=BASE).refund(
            "pi_1", idempotency_key="key-1"
        )


async def test_refund_counts_a_pending_refund_as_done(mock_http) -> None:
    mock_http.add(REFUNDS_URL, httpx2.Response(200, json={"id": "re_1", "status": "pending"}))

    await StripeRest(mock_http.client(), KEY, base_url=BASE).refund("pi_1", idempotency_key="key-1")
