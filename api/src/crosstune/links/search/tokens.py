"""Credentials for the streaming services that need one: signed, cached, and renewed."""

import asyncio
import time
from collections.abc import Callable

import httpx2
import jwt

from crosstune.config import load_apple_music_key
from crosstune.links.search.types import SearchAuthError

TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token"  # noqa: S105 -- endpoint, not a secret

# Apple accepts a developer token for up to six months, but a short life limits a leak.
# The token is signed for a day and replaced at half that.
_APPLE_LIFETIME_SECONDS = 86_400
_APPLE_REUSE_SECONDS = 43_200
_TIDAL_EARLY_RENEWAL_SECONDS = 60


class AppleMusicToken:
    """The developer token Apple Music requires on every catalog request."""

    def __init__(
        self,
        *,
        team_id: str,
        key_id: str,
        private_key: str,
        clock: Callable[[], float] = time.time,
    ) -> None:
        self._team_id = team_id
        self._key_id = key_id
        self._private_key = load_apple_music_key(private_key)
        self._clock = clock
        self._token = ""
        self._issued_at = 0.0

    def get(self) -> str:
        """Return the cached token, signing a new one once it is 12 hours old."""
        now = self._clock()
        if not self._token or now - self._issued_at >= _APPLE_REUSE_SECONDS:
            issued = int(now)
            try:
                self._token = jwt.encode(
                    {"iss": self._team_id, "iat": issued, "exp": issued + _APPLE_LIFETIME_SECONDS},
                    self._private_key,
                    algorithm="ES256",
                    headers={"kid": self._key_id},
                )
            except (jwt.PyJWTError, ValueError, TypeError):
                # Dropping the cause keeps the signing key out of any captured traceback.
                msg = "could not sign the Apple Music developer token"
                raise SearchAuthError(msg) from None
            self._issued_at = now
        return self._token

    def invalidate(self) -> None:
        """Drop the cached token so the next call signs a new one."""
        self._token = ""


class TidalToken:
    """The client-credentials access token TIDAL requires on every catalog request."""

    def __init__(
        self,
        *,
        client_id: str,
        client_secret: str,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._auth = httpx2.BasicAuth(client_id, client_secret)
        self._clock = clock
        self._token = ""
        self._expires_at = 0.0
        # Every search shares the token, so an expiry must not send each one to TIDAL's
        # rate-limited token endpoint at once.
        self._lock = asyncio.Lock()

    async def get(self, client: httpx2.AsyncClient, timeout: float) -> str:  # noqa: ASYNC109
        """Return the cached token, requesting a new one shortly before it expires."""
        if self._fresh():
            return self._token
        async with self._lock:
            if self._fresh():
                return self._token
            return await self._request(client, timeout)

    def _fresh(self) -> bool:
        return bool(self._token) and self._clock() <= self._expires_at

    async def _request(self, client: httpx2.AsyncClient, timeout: float) -> str:  # noqa: ASYNC109
        response = await client.post(
            TIDAL_TOKEN_URL,
            data={"grant_type": "client_credentials"},
            auth=self._auth,
            timeout=timeout,
        )
        if _rejects_client(response):
            msg = f"TIDAL refused the client credentials with {response.status_code}"
            raise SearchAuthError(msg)
        response.raise_for_status()
        body = response.json()
        self._token = body["access_token"]
        self._expires_at = self._clock() + float(body["expires_in"]) - _TIDAL_EARLY_RENEWAL_SECONDS
        return self._token

    def invalidate(self) -> None:
        """Drop the cached token so the next call requests a new one."""
        self._token = ""


def _rejects_client(response: httpx2.Response) -> bool:
    # OAuth answers bad client credentials with 401, or with 400 and "invalid_client".
    if response.status_code == httpx2.codes.UNAUTHORIZED:
        return True
    if response.status_code != httpx2.codes.BAD_REQUEST:
        return False
    try:
        body = response.json()
    except ValueError:
        return False
    return isinstance(body, dict) and body.get("error") == "invalid_client"
