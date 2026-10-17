"""The Sign in with Apple client exchanges a code for a refresh token and revokes it."""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import parse_qs

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from crosstune.http import BlockedAddressError
from crosstune.users.apple import (
    APPLE_APP_CLIENT_ID,
    APPLE_REVOKE_URL,
    APPLE_TOKEN_URL,
    APPLE_WEB_CLIENT_ID,
    AppleRestSignIn,
    AppleRevokeError,
)

if TYPE_CHECKING:
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

TEAM_ID = "TEAM123456"
KEY_ID = "KEY1234567"
NOW = 1_700_000_000.0


@pytest.fixture(scope="module")
def ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def signing_pem(ec_key: ec.EllipticCurvePrivateKey) -> str:
    return ec_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def _client(http: httpx2.AsyncClient, signing_pem: str) -> AppleRestSignIn:
    return AppleRestSignIn(
        http, team_id=TEAM_ID, key_id=KEY_ID, private_key=signing_pem, clock=lambda: NOW
    )


def _id_token(sub: str) -> str:
    return jwt.encode({"sub": sub}, "x" * 32, algorithm="HS256")


def _form(request: httpx2.Request) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(request.content.decode()).items()}


def test_client_secret_header_and_claims(
    ec_key: ec.EllipticCurvePrivateKey, signing_pem: str, mock_http: MockHttp
) -> None:
    token = _client(mock_http.client(), signing_pem).client_secret(APPLE_APP_CLIENT_ID)

    header = jwt.get_unverified_header(token)
    assert header["alg"] == "ES256"
    assert header["kid"] == KEY_ID
    claims = jwt.decode(
        token,
        ec_key.public_key(),
        algorithms=["ES256"],
        audience="https://appleid.apple.com",
        options={"verify_iat": False, "verify_exp": False},
    )
    assert claims["iss"] == TEAM_ID
    assert claims["sub"] == APPLE_APP_CLIENT_ID == "app.crosstune.Crosstune"
    assert claims["iat"] == int(NOW)
    assert claims["exp"] == int(NOW) + 300


async def test_revoke_exchanges_then_revokes(signing_pem: str, mock_http: MockHttp) -> None:
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(200, json={"refresh_token": "r1", "id_token": _id_token("001.abc")}),
    )
    mock_http.add(APPLE_REVOKE_URL, httpx2.Response(200))

    await _client(mock_http.client(), signing_pem).revoke(
        "c1", frozenset({"001.abc"}), client="app"
    )

    assert [str(r.url) for r in mock_http.calls] == [APPLE_TOKEN_URL, APPLE_REVOKE_URL]
    exchange, revoke = (_form(r) for r in mock_http.calls)
    assert exchange["grant_type"] == "authorization_code"
    assert exchange["code"] == "c1"
    assert exchange["client_id"] == APPLE_APP_CLIENT_ID
    assert exchange["client_secret"]
    assert revoke["token"] == "r1"
    assert revoke["token_type_hint"] == "refresh_token"
    assert revoke["client_id"] == APPLE_APP_CLIENT_ID
    assert revoke["client_secret"]


async def test_a_web_code_revokes_with_the_services_id(
    ec_key: ec.EllipticCurvePrivateKey, signing_pem: str, mock_http: MockHttp
) -> None:
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(200, json={"refresh_token": "r1", "id_token": _id_token("001.abc")}),
    )
    mock_http.add(APPLE_REVOKE_URL, httpx2.Response(200))

    await _client(mock_http.client(), signing_pem).revoke(
        "c1", frozenset({"001.abc"}), client="web"
    )

    assert APPLE_WEB_CLIENT_ID == "app.crosstune.signin"
    for form in (_form(r) for r in mock_http.calls):
        assert form["client_id"] == APPLE_WEB_CLIENT_ID
        claims = jwt.decode(
            form["client_secret"],
            ec_key.public_key(),
            algorithms=["ES256"],
            audience="https://appleid.apple.com",
            options={"verify_iat": False, "verify_exp": False},
        )
        assert claims["sub"] == APPLE_WEB_CLIENT_ID


async def test_revoke_skips_a_different_apple_id(signing_pem: str, mock_http: MockHttp) -> None:
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(200, json={"refresh_token": "r1", "id_token": _id_token("001.other")}),
    )

    with pytest.raises(AppleRevokeError) as caught:
        await _client(mock_http.client(), signing_pem).revoke(
            "c1", frozenset({"001.abc"}), client="app"
        )

    assert caught.value.step == "mismatch"
    assert [str(r.url) for r in mock_http.calls] == [APPLE_TOKEN_URL]


async def test_exchange_error_carries_apples_error(signing_pem: str, mock_http: MockHttp) -> None:
    code = "SECRET-AUTH-CODE-7f3a"
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(
            400,
            json={"error": "invalid_grant", "error_description": f"code {code} has expired"},
        ),
    )

    with pytest.raises(AppleRevokeError) as caught:
        await _client(mock_http.client(), signing_pem).revoke(
            code, frozenset({"001.abc"}), client="app"
        )

    assert caught.value.step == "exchange"
    assert caught.value.apple_error == "invalid_grant"
    assert "invalid_grant" in str(caught.value)
    assert code not in str(caught.value)
    assert code not in repr(caught.value.args)


@pytest.mark.parametrize("sub", [["001.abc"], {"id": "001.abc"}, 7, None], ids=repr)
async def test_a_sub_that_is_not_a_string_is_a_mismatch(
    signing_pem: str, mock_http: MockHttp, sub: object
) -> None:
    id_token = jwt.encode({"sub": sub}, "x" * 32, algorithm="HS256")
    mock_http.add(
        APPLE_TOKEN_URL, httpx2.Response(200, json={"refresh_token": "r1", "id_token": id_token})
    )

    with pytest.raises(AppleRevokeError) as caught:
        await _client(mock_http.client(), signing_pem).revoke(
            "c1", frozenset({"001.abc"}), client="app"
        )

    assert caught.value.step == "mismatch"
    assert [str(r.url) for r in mock_http.calls] == [APPLE_TOKEN_URL]


async def test_every_request_carries_the_timeout(signing_pem: str, mock_http: MockHttp) -> None:
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(200, json={"refresh_token": "r1", "id_token": _id_token("001.abc")}),
    )
    mock_http.add(APPLE_REVOKE_URL, httpx2.Response(200))
    apple = AppleRestSignIn(
        mock_http.client(), team_id=TEAM_ID, key_id=KEY_ID, private_key=signing_pem, timeout=3.5
    )

    await apple.revoke("c1", frozenset({"001.abc"}), client="app")

    assert len(mock_http.calls) == 2
    for request in mock_http.calls:
        assert request.extensions["timeout"] == httpx2.Timeout(3.5).as_dict()


@pytest.mark.parametrize(
    "response",
    [httpx2.Response(200, json={}), httpx2.Response(200, text="not json")],
    ids=["empty-object", "non-json"],
)
async def test_exchange_without_tokens_fails(
    signing_pem: str, mock_http: MockHttp, response: httpx2.Response
) -> None:
    mock_http.add(APPLE_TOKEN_URL, response)

    with pytest.raises(AppleRevokeError) as caught:
        await _client(mock_http.client(), signing_pem).revoke(
            "c1", frozenset({"001.abc"}), client="app"
        )

    assert caught.value.step == "exchange"
    assert [str(r.url) for r in mock_http.calls] == [APPLE_TOKEN_URL]


async def test_revoke_error(signing_pem: str, mock_http: MockHttp) -> None:
    mock_http.add(
        APPLE_TOKEN_URL,
        httpx2.Response(200, json={"refresh_token": "r1", "id_token": _id_token("001.abc")}),
    )
    mock_http.add(APPLE_REVOKE_URL, httpx2.Response(400, json={"error": "invalid_request"}))

    with pytest.raises(AppleRevokeError) as caught:
        await _client(mock_http.client(), signing_pem).revoke(
            "c1", frozenset({"001.abc"}), client="app"
        )

    assert caught.value.step == "revoke"
    assert caught.value.apple_error == "invalid_request"


async def test_transport_error_is_an_exchange_failure(signing_pem: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        msg = "slow"
        raise httpx2.ConnectTimeout(msg, request=request)

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))

    with pytest.raises(AppleRevokeError) as caught:
        await _client(http, signing_pem).revoke("c1", frozenset({"001.abc"}), client="app")

    assert caught.value.step == "exchange"


async def test_transport_error_at_revoke_is_a_revoke_failure(signing_pem: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        if str(request.url) == APPLE_TOKEN_URL:
            return httpx2.Response(
                200, json={"refresh_token": "r1", "id_token": _id_token("001.abc")}
            )
        msg = "reset"
        raise httpx2.ReadError(msg, request=request)

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))

    with pytest.raises(AppleRevokeError) as caught:
        await _client(http, signing_pem).revoke("c1", frozenset({"001.abc"}), client="app")

    assert caught.value.step == "revoke"


async def test_a_blocked_address_is_an_exchange_failure(signing_pem: str) -> None:
    def handler(request: httpx2.Request) -> httpx2.Response:
        msg = "blocked"
        raise BlockedAddressError(msg)

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handler))

    with pytest.raises(AppleRevokeError) as caught:
        await _client(http, signing_pem).revoke("c1", frozenset({"001.abc"}), client="app")

    assert caught.value.step == "exchange"


async def test_a_redirect_is_refused_and_not_followed(signing_pem: str) -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(302, headers={"location": "https://elsewhere.example/steal"})

    http = httpx2.AsyncClient(transport=httpx2.MockTransport(handler), follow_redirects=True)

    with pytest.raises(AppleRevokeError) as caught:
        await _client(http, signing_pem).revoke("c1", frozenset({"001.abc"}), client="app")

    assert caught.value.step == "exchange"
    assert len(requests) == 1
