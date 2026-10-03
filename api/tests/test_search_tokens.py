"""The Apple Music developer token and the TIDAL access token are signed, cached, and renewed."""

from __future__ import annotations

import base64
from typing import TYPE_CHECKING

import httpx2
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from crosstune.links.search.tokens import TIDAL_TOKEN_URL, AppleMusicToken, TidalToken
from crosstune.links.search.types import SearchAuthError

if TYPE_CHECKING:
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

TEAM_ID = "TEAM123456"
KEY_ID = "KEY1234567"
NOW = 1_700_000_000.0


class FakeClock:
    """A clock a test moves by hand."""

    def __init__(self, now: float = NOW) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now


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


def _apple(signing_pem: str, clock: FakeClock) -> AppleMusicToken:
    return AppleMusicToken(team_id=TEAM_ID, key_id=KEY_ID, private_key=signing_pem, clock=clock)


def test_apple_music_token_claims(ec_key: ec.EllipticCurvePrivateKey, signing_pem: str) -> None:
    token = _apple(signing_pem, FakeClock()).get()

    header = jwt.get_unverified_header(token)
    assert header["alg"] == "ES256"
    assert header["kid"] == KEY_ID
    claims = jwt.decode(
        token,
        ec_key.public_key(),
        algorithms=["ES256"],
        options={"verify_iat": False, "verify_exp": False},
    )
    assert claims == {"iss": TEAM_ID, "iat": int(NOW), "exp": int(NOW) + 86_400}


def test_apple_music_token_reused_for_12_hours_then_renewed(signing_pem: str) -> None:
    clock = FakeClock()
    apple = _apple(signing_pem, clock)
    first = apple.get()

    clock.now = NOW + 11 * 3600
    assert apple.get() == first

    clock.now = NOW + 12 * 3600
    assert apple.get() != first


def test_apple_music_invalidate_forces_a_new_token(signing_pem: str) -> None:
    clock = FakeClock()
    apple = _apple(signing_pem, clock)
    first = apple.get()
    clock.now += 1
    apple.invalidate()

    assert apple.get() != first


def _tidal(clock: FakeClock) -> TidalToken:
    return TidalToken(client_id="cid", client_secret="csecret", clock=clock)


def _answer(mock_http: MockHttp) -> None:
    mock_http.add(
        TIDAL_TOKEN_URL, httpx2.Response(200, json={"access_token": "a", "expires_in": 3600})
    )


def _token_calls(mock_http: MockHttp) -> list[httpx2.Request]:
    return [call for call in mock_http.calls if str(call.url) == TIDAL_TOKEN_URL]


async def test_tidal_token_cached_until_shortly_before_expiry(mock_http: MockHttp) -> None:
    _answer(mock_http)
    clock = FakeClock(0.0)
    tidal = _tidal(clock)
    async with mock_http.client() as client:
        assert await tidal.get(client, 5.0) == "a"
        assert await tidal.get(client, 5.0) == "a"
        assert len(_token_calls(mock_http)) == 1

        clock.now = 3_540
        await tidal.get(client, 5.0)
        assert len(_token_calls(mock_http)) == 1

        clock.now = 3_541
        await tidal.get(client, 5.0)
        assert len(_token_calls(mock_http)) == 2

    request = _token_calls(mock_http)[0]
    expected = base64.b64encode(b"cid:csecret").decode()
    assert request.method == "POST"
    assert request.headers["authorization"] == f"Basic {expected}"
    assert request.content == b"grant_type=client_credentials"


async def test_tidal_invalidate_forces_a_new_request(mock_http: MockHttp) -> None:
    _answer(mock_http)
    tidal = _tidal(FakeClock(0.0))
    async with mock_http.client() as client:
        await tidal.get(client, 5.0)
        tidal.invalidate()
        await tidal.get(client, 5.0)

    assert len(_token_calls(mock_http)) == 2


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(400, json={"error": "invalid_client"}),
        httpx2.Response(401, json={"error": "invalid_client"}),
        httpx2.Response(401),
    ],
)
async def test_tidal_rejected_client_raises_search_auth_error(
    mock_http: MockHttp, response: httpx2.Response
) -> None:
    mock_http.add(TIDAL_TOKEN_URL, response)
    async with mock_http.client() as client:
        with pytest.raises(SearchAuthError):
            await _tidal(FakeClock()).get(client, 5.0)


@pytest.mark.parametrize(
    "response",
    [
        httpx2.Response(400, json={"error": "invalid_request"}),
        httpx2.Response(400, text="not json"),
        httpx2.Response(503),
    ],
)
async def test_tidal_other_token_failures_stay_http_errors(
    mock_http: MockHttp, response: httpx2.Response
) -> None:
    mock_http.add(TIDAL_TOKEN_URL, response)
    async with mock_http.client() as client:
        with pytest.raises(httpx2.HTTPStatusError):
            await _tidal(FakeClock()).get(client, 5.0)
