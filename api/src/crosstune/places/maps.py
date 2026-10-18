"""Apple Maps Server API client: place search and reverse geocoding."""

import asyncio
import math
import time
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

import httpx2
import jwt

from crosstune.config import Settings, load_apple_p256_key
from crosstune.links.fetch import get_json
from crosstune.places.countries import country as country_named
from crosstune.places.names import place_name, suggestion_name

MAPS_URL = "https://maps-api.apple.com"
MAX_HITS = 10
# Venues, landmarks, street addresses, and towns together. The only location hint is the
# account country's fixed center, so an address that repeats across states lists every match
# rather than the nearest, and a place abroad is still found.
_SEARCH_TYPES = "poi,address"
_SIGNING_LIFETIME_SECONDS = 3_600
_EARLY_RENEWAL_SECONDS = 60
_DEFAULT_RETRY_AFTER_SECONDS = 60.0


@dataclass(frozen=True)
class PlaceHit:
    """A named place with its coordinates, and the two lines that tell it apart in a list."""

    name: str
    lat: float
    lon: float
    title: str
    subtitle: str | None = None


class MapsError(Exception):
    """Apple Maps could not answer.

    `transient` says whether the same request could succeed later: an outage, a rate limit,
    a network failure, or a lapsed token, as against a request or answer that will stay bad.
    """

    def __init__(self, message: str, *, transient: bool = False) -> None:
        super().__init__(message)
        self.transient = transient


class _MapsRejectedTokenError(MapsError):
    """Apple Maps refused the access token; the next lookup exchanges for a new one."""

    def __init__(self, message: str) -> None:
        super().__init__(message, transient=True)


class MapsBusyError(MapsError):
    """Apple Maps is rate limiting this key."""

    def __init__(self, retry_after_seconds: float) -> None:
        super().__init__(f"Apple Maps is busy, retry in {retry_after_seconds:g}s", transient=True)
        self.retry_after_seconds = retry_after_seconds


class AppleMaps:
    """Searches and reverse geocodes through Apple Maps with a cached access token."""

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
        self._private_key = load_apple_p256_key(private_key)
        self._clock = clock
        self._token = ""
        self._expires_at = 0.0
        # Concurrent lookups share one exchange when the token lapses.
        self._lock = asyncio.Lock()

    async def search(
        self,
        client: httpx2.AsyncClient,
        query: str,
        *,
        country: str | None,
        timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout
    ) -> list[PlaceHit]:
        """Suggest places, street addresses, and towns as a query is typed, each named as picked.

        Args:
            client: The outbound client.
            query: The text typed so far.
            country: The account's two-letter country code. Results lean toward its center
                point and its rows leave out its name; None or an unknown code leans nowhere.
            timeout: The per-request timeout in seconds.

        Returns:
            list[PlaceHit]: At most MAX_HITS places that have a usable name and coordinates.

        Raises:
            MapsBusyError: If Apple Maps rate limits the key.
            MapsError: If Apple Maps fails or answers unreadably.
        """
        home = country_named(country)
        params = {"q": query, "resultTypeFilter": _SEARCH_TYPES}
        if home:
            params["searchLocation"] = f"{home.lat},{home.lon}"
        body = await self._get(client, "/v1/searchAutocomplete", params, timeout)
        hits: list[PlaceHit] = []
        for result in _results(body):
            location = result.get("location")
            if not isinstance(location, dict):
                continue
            lat, lon = location.get("latitude"), location.get("longitude")
            picked = suggestion_name(result, home.name if home else None)
            if not picked or not _is_number(lat) or not _is_number(lon):
                continue
            hits.append(
                PlaceHit(
                    name=picked.name,
                    lat=float(lat),
                    lon=float(lon),
                    title=picked.title,
                    subtitle=picked.subtitle,
                )
            )
            if len(hits) == MAX_HITS:
                break
        return hits

    async def reverse_name(
        self,
        client: httpx2.AsyncClient,
        lat: float,
        lon: float,
        *,
        timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout
    ) -> str | None:
        """Name the place at a coordinate.

        Args:
            client: The outbound client.
            lat: Latitude in degrees.
            lon: Longitude in degrees.
            timeout: The per-request timeout in seconds.

        Returns:
            str | None: The first result's name, or None when Apple Maps knows no place there.

        Raises:
            MapsBusyError: If Apple Maps rate limits the key.
            MapsError: If Apple Maps fails or answers unreadably.
        """
        body = await self._get(client, "/v1/reverseGeocode", {"loc": f"{lat},{lon}"}, timeout)
        results = _results(body)
        return place_name(results[0]) if results else None

    async def _get(
        self,
        client: httpx2.AsyncClient,
        path: str,
        params: dict[str, str],
        timeout: float,  # noqa: ASYNC109
    ) -> Any:
        token = await self._access_token(client, timeout)
        try:
            return await _call(
                client, f"{MAPS_URL}{path}", params, {"Authorization": f"Bearer {token}"}, timeout
            )
        except _MapsRejectedTokenError:
            # The next lookup exchanges for a new token instead of reusing a revoked one.
            self._token = ""
            raise

    async def _access_token(self, client: httpx2.AsyncClient, timeout: float) -> str:  # noqa: ASYNC109
        if self._fresh():
            return self._token
        async with self._lock:
            if self._fresh():
                return self._token
            body = await _call(
                client,
                f"{MAPS_URL}/v1/token",
                None,
                {"Authorization": f"Bearer {self._sign()}"},
                timeout,
            )
            try:
                token = body["accessToken"]
                lifetime = float(body["expiresInSeconds"])
            except (KeyError, TypeError, ValueError):
                token, lifetime = "", 0.0
            if not isinstance(token, str) or not token:
                msg = "Apple Maps returned no access token"
                raise MapsError(msg)
            self._token = token
            self._expires_at = self._clock() + lifetime - _EARLY_RENEWAL_SECONDS
            return token

    def _fresh(self) -> bool:
        return bool(self._token) and self._clock() < self._expires_at

    def _sign(self) -> str:
        issued = int(self._clock())
        try:
            return jwt.encode(
                {"iss": self._team_id, "iat": issued, "exp": issued + _SIGNING_LIFETIME_SECONDS},
                self._private_key,
                algorithm="ES256",
                headers={"kid": self._key_id},
            )
        except (jwt.PyJWTError, ValueError, TypeError):
            # Dropping the cause keeps the signing key out of any captured traceback.
            msg = "could not sign the Apple Maps token"
            raise MapsError(msg) from None


def configured_maps(settings: Settings) -> AppleMaps | None:
    """Build the Apple Maps client from settings, so every caller signs with the same key.

    Returns:
        AppleMaps | None: The client, or None when the Apple Maps key is not configured.
    """
    if not settings.apple_maps_configured:
        return None
    return AppleMaps(
        team_id=settings.apple_team_id,
        key_id=settings.apple_maps_key_id,
        private_key=settings.apple_maps_private_key.get_secret_value(),
    )


async def _call(
    client: httpx2.AsyncClient,
    url: str,
    params: dict[str, str] | None,
    headers: dict[str, str],
    timeout: float,  # noqa: ASYNC109
) -> Any:
    try:
        return await get_json(client, url, params=params, headers=headers, timeout=timeout)
    except httpx2.HTTPStatusError as error:
        response = error.response
        if response.status_code == httpx2.codes.TOO_MANY_REQUESTS:
            raise MapsBusyError(_retry_after(response)) from None
        msg = f"Apple Maps answered {response.status_code}"
        if response.status_code == httpx2.codes.UNAUTHORIZED:
            raise _MapsRejectedTokenError(msg) from None
        transient = response.is_server_error or response.status_code == httpx2.codes.REQUEST_TIMEOUT
        raise MapsError(msg, transient=transient) from None
    except httpx2.HTTPError as error:
        msg = f"Apple Maps request failed: {type(error).__name__}"
        raise MapsError(msg, transient=True) from None
    except ValueError as error:
        msg = f"Apple Maps answered unreadably: {type(error).__name__}"
        raise MapsError(msg) from None


def _retry_after(response: httpx2.Response) -> float:
    try:
        seconds = float(response.headers["Retry-After"])
    except (KeyError, ValueError):
        return _DEFAULT_RETRY_AFTER_SECONDS
    # An HTTP-date value does not parse and takes the default; nan and inf are no delay at all.
    return max(seconds, 0.0) if math.isfinite(seconds) else _DEFAULT_RETRY_AFTER_SECONDS


def _results(body: object) -> list[dict]:
    results = body.get("results") if isinstance(body, dict) else None
    if not isinstance(results, list):
        return []
    return [result for result in results if isinstance(result, dict)]


def _is_number(value: object) -> bool:
    return isinstance(value, int | float) and not isinstance(value, bool)
