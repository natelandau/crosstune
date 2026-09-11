"""Cached JWKS lookup."""

from __future__ import annotations

import asyncio
import time
from typing import TYPE_CHECKING

import jwt

if TYPE_CHECKING:
    import httpx2

REFRESH_COOLDOWN_SECONDS = 60


class JwksCache:
    """Holds Clerk's signing keys. Refetches at most once a minute when a kid is unknown."""

    def __init__(self, url: str, client: httpx2.AsyncClient) -> None:
        self._url = url
        self._client = client
        self._keys: dict[str, jwt.PyJWK] = {}
        self._lock = asyncio.Lock()
        # Never fetched. A freshly booted host's monotonic clock starts near zero, which
        # would otherwise read as a fetch inside the cooldown.
        self._last_fetch = float("-inf")

    async def get_key(self, kid: str) -> jwt.PyJWK | None:
        """Return the cached key for `kid`, refreshing from the JWKS endpoint if needed."""
        key = self._keys.get(kid)
        if key is None and time.monotonic() - self._last_fetch > REFRESH_COOLDOWN_SECONDS:
            await self._refresh()
            key = self._keys.get(kid)
        return key

    async def _refresh(self) -> None:
        # The whole fetch runs under the lock: a caller that waited must see the keys it
        # waited for, not an empty cache behind a fresh timestamp.
        async with self._lock:
            if time.monotonic() - self._last_fetch <= REFRESH_COOLDOWN_SECONDS:
                return
            try:
                response = await self._client.get(self._url, timeout=5.0)
                response.raise_for_status()
                keys = response.json().get("keys", [])
                self._keys = {k["kid"]: jwt.PyJWK(k) for k in keys if "kid" in k}
            finally:
                # Recorded even for a failed attempt, so a broken endpoint is not hammered.
                self._last_fetch = time.monotonic()
