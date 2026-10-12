"""The Resend mailer: one POST per message, any refusal raised, no redirect followed."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

import httpx2
import pytest

from crosstune.email.resend import (
    EmailMessage,
    MailerRateLimitedError,
    MailerUnavailableError,
    ResendMailer,
)

if TYPE_CHECKING:
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

API_KEY = "re_test_key"  # gitleaks:allow -- fixture, not a credential
SENDER = "Crosstune <no-reply@mail.crosstune.app>"
MESSAGE = EmailMessage(
    to="person@example.com", subject="Hello", text="Plain body", html="<p>Html body</p>"
)


def _mailer(mock_http: MockHttp) -> ResendMailer:
    return ResendMailer(mock_http.client(), API_KEY, SENDER)


async def test_send_posts_the_message(mock_http: MockHttp) -> None:
    mock_http.add("https://api.resend.com/emails", httpx2.Response(200, json={"id": "e1"}))

    await _mailer(mock_http).send(MESSAGE, idempotency_key="warn-1")

    (call,) = [c for c in mock_http.calls if c.url.host == "api.resend.com"]
    assert call.method == "POST"
    assert call.url.path == "/emails"
    assert call.headers["Authorization"] == f"Bearer {API_KEY}"
    assert call.headers["Idempotency-Key"] == "warn-1"
    assert json.loads(call.content) == {
        "from": SENDER,
        "to": ["person@example.com"],
        "subject": "Hello",
        "text": "Plain body",
        "html": "<p>Html body</p>",
    }


@pytest.mark.parametrize("status", [400, 401, 403, 409, 422, 429, 500])
async def test_send_raises_on_refusal(mock_http: MockHttp, status: int) -> None:
    mock_http.add("https://api.resend.com/emails", httpx2.Response(status, json={}))

    with pytest.raises(MailerUnavailableError):
        await _mailer(mock_http).send(MESSAGE, idempotency_key="warn-1")


async def test_send_raises_rate_limited_on_429(mock_http: MockHttp) -> None:
    mock_http.add("https://api.resend.com/emails", httpx2.Response(429, json={}))

    with pytest.raises(MailerRateLimitedError):
        await _mailer(mock_http).send(MESSAGE, idempotency_key="warn-1")


async def test_send_raises_on_transport_error() -> None:
    def boom(_request: httpx2.Request) -> httpx2.Response:
        msg = "connection closed"
        raise httpx2.ConnectError(msg)

    client = httpx2.AsyncClient(transport=httpx2.MockTransport(boom))
    try:
        with pytest.raises(MailerUnavailableError):
            await ResendMailer(client, API_KEY, SENDER).send(MESSAGE, idempotency_key="k")
    finally:
        await client.aclose()


async def test_send_never_follows_a_redirect(mock_http: MockHttp) -> None:
    mock_http.add(
        "https://api.resend.com/emails",
        httpx2.Response(307, headers={"Location": "https://elsewhere.example/emails"}),
    )
    mock_http.add("https://elsewhere.example/", httpx2.Response(200, json={"id": "e1"}))

    with pytest.raises(MailerUnavailableError):
        await _mailer(mock_http).send(MESSAGE, idempotency_key="warn-1")

    assert all(c.url.host != "elsewhere.example" for c in mock_http.calls)


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(200, json={}),
        httpx2.Response(200, json={"id": ""}),
        httpx2.Response(200, json={"id": 7}),
        httpx2.Response(200, json=["e1"]),
        httpx2.Response(200, text="accepted"),
    ],
    ids=["empty", "blank-id", "number-id", "list", "not-json"],
)
async def test_send_raises_on_a_2xx_without_a_message_id(
    mock_http: MockHttp, response: httpx2.Response
) -> None:
    mock_http.add("https://api.resend.com/emails", response)

    with pytest.raises(MailerUnavailableError, match="without a message id"):
        await _mailer(mock_http).send(MESSAGE, idempotency_key="warn-1")
