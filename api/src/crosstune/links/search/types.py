"""The shape every search adapter returns, and the rules every adapter's hits follow."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Generator, Iterable
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol

import httpx2

from crosstune.links.detect import detect_provider, normalize_url

MAX_HITS = 10
FALLBACK_COUNTRY = "US"
_AUTH_STATUSES = frozenset({401, 403})
# A 403 refuses the request, not the token (RFC 6750), so a new token would not help.
_EXPIRED_TOKEN_STATUS = 401
# How a catalog answers a country or storefront it does not serve.
_REGION_STATUSES = frozenset({400, 404})


@dataclass(frozen=True)
class SearchHit:
    """One recording a service found, in the form a paste of its URL would store."""

    url: str
    provider: str
    provider_ref: str | None
    title: str
    subtitle: str | None
    artwork_url: str | None


@dataclass(frozen=True)
class AdapterAnswer:
    """An adapter's hits, and the country whose catalog produced them."""

    hits: list[SearchHit]
    country: str


Adapter = Callable[[str, str, httpx2.AsyncClient, float], Awaitable[AdapterAnswer]]
"""Called as `(query, country, client, timeout)`."""


class SearchAuthError(Exception):
    """The service rejected the API's own credentials, so no retry by a user can succeed."""


class RegionNotServedError(Exception):
    """The service does not serve the requested country, so a US search may answer instead."""


class _Token(Protocol):
    def invalidate(self) -> None: ...


@contextmanager
def auth_errors(token: _Token) -> Generator[None]:
    """Turn a 401 or 403 into SearchAuthError, and drop the token on a 401.

    Args:
        token: The cached credential the request carried.

    Raises:
        SearchAuthError: If the service answered 401 or 403.
    """
    try:
        yield
    except httpx2.HTTPStatusError as error:
        status = error.response.status_code
        if status not in _AUTH_STATUSES:
            raise
        if status == _EXPIRED_TOKEN_STATUS:
            token.invalidate()
        msg = f"{error.request.url.host} refused the credentials with {status}"
        raise SearchAuthError(msg) from error


@contextmanager
def region_errors(country: str) -> Generator[None]:
    """Turn a catalog's refusal of a country it does not serve into RegionNotServedError.

    A refusal of the US itself stays an HTTP error, since no catalog serves a narrower
    fallback.

    Args:
        country: The uppercase two-letter country code the request carried.

    Raises:
        RegionNotServedError: If the service answered 400 or 404 for a country other than
            the US.
    """
    try:
        yield
    except httpx2.HTTPStatusError as error:
        if country == FALLBACK_COUNTRY or error.response.status_code not in _REGION_STATUSES:
            raise
        msg = f"{error.request.url.host} does not serve {country}"
        raise RegionNotServedError(msg) from error


def text(value: object) -> str | None:
    """Return a non-empty string from an untrusted JSON field, trimmed, or None."""
    return (value.strip() or None) if isinstance(value, str) else None


def build_hit(
    url: object,
    *,
    provider: str,
    title: object,
    subtitle: str | None = None,
    artwork_url: str | None = None,
) -> SearchHit | None:
    """Build a hit from a service's URL exactly as a paste of that URL would store it.

    Args:
        url: The recording's URL as the service gave it.
        provider: The provider the adapter searches; a URL detected as any other is dropped.
        title: The recording's title as the service gave it.
        subtitle: Artist, album, or creator, when the service has them.
        artwork_url: An artwork URL, carried for the link but never shown in results.

    Returns:
        SearchHit | None: The hit, or None when the URL or title is unusable.
    """
    url_text, title_text = text(url), text(title)
    if url_text is None or title_text is None:
        return None
    detected, ref = detect_provider(url_text)
    if detected != provider or ref is None:
        return None
    return SearchHit(
        url=normalize_url(url_text, detected, ref),
        provider=detected,
        provider_ref=ref,
        title=title_text,
        subtitle=subtitle,
        artwork_url=artwork_url,
    )


def collect(hits: Iterable[SearchHit | None]) -> list[SearchHit]:
    """Keep the first MAX_HITS distinct hits, in the service's order.

    Args:
        hits: Candidate hits, None for one that was unusable.

    Returns:
        list[SearchHit]: Hits with no two sharing a URL.
    """
    seen: set[str] = set()
    kept: list[SearchHit] = []
    for hit in hits:
        if hit is None or hit.url in seen:
            continue
        seen.add(hit.url)
        kept.append(hit)
        if len(kept) == MAX_HITS:
            break
    return kept


def items(value: object) -> list[object]:
    """Return a JSON array, or an empty list for anything else."""
    return value if isinstance(value, list) else []


def field(value: object, key: str) -> object:
    """Read a key from a JSON object, or None when the value is not an object."""
    return value.get(key) if isinstance(value, dict) else None
