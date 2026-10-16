"""Sign in with Apple client, for revoking a user's authorization when their account is deleted."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any, Literal, Protocol

import httpx2
import jwt

from crosstune.config import load_apple_music_key
from crosstune.http import BlockedAddressError
from crosstune.rest import DEFAULT_TIMEOUT_SECONDS

if TYPE_CHECKING:
    from collections.abc import Callable

    from cryptography.hazmat.primitives.asymmetric import ec

APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token"  # noqa: S105 -- endpoint, not a secret
APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke"
APPLE_APP_CLIENT_ID = "app.crosstune.Crosstune"
_APPLE_AUDIENCE = "https://appleid.apple.com"
_SECRET_LIFETIME_SECONDS = 300

RevokeStep = Literal["exchange", "mismatch", "revoke"]
_EXCHANGE: RevokeStep = "exchange"
_MISMATCH: RevokeStep = "mismatch"
_REVOKE: RevokeStep = "revoke"


class AppleRevokeError(Exception):
    """Revoking the Apple authorization failed at one step.

    The message names the step and Apple's error code only, so it never carries the
    authorization code or a token.
    """

    def __init__(self, step: RevokeStep, apple_error: str | None = None) -> None:
        self.step: RevokeStep = step
        self.apple_error = apple_error
        message = f"Sign in with Apple {step} failed"
        if apple_error:
            message = f"{message}: {apple_error}"
        super().__init__(message)


class AppleSignIn(Protocol):
    """What account deletion needs from Apple, held on `app.state`."""

    async def revoke(self, code: str, apple_user_ids: frozenset[str]) -> None:
        """Exchange the authorization code and revoke the resulting refresh token.

        Args:
            code: The one-time authorization code the app obtained at sign-in.
            apple_user_ids: The Apple user IDs linked to the account being deleted.

        Raises:
            AppleRevokeError: On any failure, including transport errors and timeouts.
        """
        ...


class AppleRestSignIn:
    """Revokes Sign in with Apple authorization through Apple's REST endpoints."""

    def __init__(
        self,
        client: httpx2.AsyncClient,
        *,
        team_id: str,
        key_id: str,
        private_key: str,
        client_id: str = APPLE_APP_CLIENT_ID,
        clock: Callable[[], float] = time.time,
        timeout: float = DEFAULT_TIMEOUT_SECONDS,
    ) -> None:
        self._client = client
        self._team_id = team_id
        self._key_id = key_id
        self._private_key: ec.EllipticCurvePrivateKey = load_apple_music_key(private_key)
        self._client_id = client_id
        self._clock = clock
        self._timeout = timeout

    def client_secret(self) -> str:
        """Sign the short-lived client secret Apple requires on every request.

        Returns:
            str: An ES256 JWT, valid for five minutes.
        """
        issued = int(self._clock())
        return jwt.encode(
            {
                "iss": self._team_id,
                "iat": issued,
                "exp": issued + _SECRET_LIFETIME_SECONDS,
                "aud": _APPLE_AUDIENCE,
                "sub": self._client_id,
            },
            self._private_key,
            algorithm="ES256",
            headers={"kid": self._key_id},
        )

    async def revoke(self, code: str, apple_user_ids: frozenset[str]) -> None:
        """Exchange the authorization code and revoke the resulting refresh token.

        Args:
            code: The one-time authorization code the app obtained at sign-in.
            apple_user_ids: The Apple user IDs linked to the account being deleted.

        Raises:
            AppleRevokeError: On any failure, including transport errors and timeouts.
        """
        body = await self._post(
            APPLE_TOKEN_URL,
            {"grant_type": "authorization_code", "code": code},
            step=_EXCHANGE,
        )
        refresh_token = body.get("refresh_token")
        id_token = body.get("id_token")
        if not isinstance(refresh_token, str) or not isinstance(id_token, str):
            raise AppleRevokeError(_EXCHANGE)

        # Safe without verifying the signature: the token came straight from Apple over
        # TLS in answer to our own request.
        try:
            subject = jwt.decode(id_token, options={"verify_signature": False}).get("sub")
        except jwt.PyJWTError:
            raise AppleRevokeError(_EXCHANGE) from None
        # A code from another Apple ID must never revoke that person's authorization.
        if not isinstance(subject, str) or subject not in apple_user_ids:
            raise AppleRevokeError(_MISMATCH)

        await self._post(
            APPLE_REVOKE_URL,
            {"token": refresh_token, "token_type_hint": "refresh_token"},
            step=_REVOKE,
        )

    async def _post(self, url: str, fields: dict[str, str], *, step: RevokeStep) -> dict[str, Any]:
        """Post a form to Apple with the client credentials and return its JSON object.

        Raises:
            AppleRevokeError: For `step`, on a transport failure or a non-2xx answer.
        """
        data = {**fields, "client_id": self._client_id, "client_secret": self.client_secret()}
        try:
            # No redirects: the form carries the code and the client secret.
            response = await self._client.post(
                url, data=data, timeout=self._timeout, follow_redirects=False
            )
        except (httpx2.HTTPError, BlockedAddressError):
            raise AppleRevokeError(step) from None
        parsed = _json_object(response)
        if not response.is_success:
            error = parsed.get("error")
            raise AppleRevokeError(step, error if isinstance(error, str) else None)
        return parsed


def _json_object(response: httpx2.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}
