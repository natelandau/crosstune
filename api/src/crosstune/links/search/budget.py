"""Keep the app's outbound search requests under each music service's own rate limit."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from crosstune.vocabulary import Provider

if TYPE_CHECKING:
    from collections.abc import Callable, Container

    from crosstune.config import Settings


class OverBudgetError(Exception):
    """The service's outbound budget has no request left, so the service is not called."""


class TokenBucket:
    """Allow a burst of requests, then a steady rate, as a token bucket.

    In any window of `t` seconds it allows at most `burst + per_second * t` requests.
    """

    def __init__(
        self,
        *,
        burst: int,
        per_second: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._burst = float(burst)
        self._per_second = per_second
        self._clock = clock
        self._tokens = float(burst)
        self._updated = clock()

    def take(self) -> bool:
        """Spend one token if there is one.

        Returns:
            bool: True when the request may be sent, False when the bucket is empty.
        """
        now = self._clock()
        self._tokens = min(self._burst, self._tokens + (now - self._updated) * self._per_second)
        self._updated = now
        if self._tokens < 1:
            return False
        self._tokens -= 1
        return True


class OutboundBudget:
    """One token bucket per service, shared by every user's searches in this process.

    A service limits the app's credential, not a user, so only a process-wide count keeps
    the app under that limit. The API runs as one process, so this count is the whole budget.
    Take and refuse run with no await between them, so concurrent searches on the event loop
    cannot both spend the last token.
    """

    def __init__(self, buckets: dict[Provider, TokenBucket]) -> None:
        self._buckets = buckets

    @classmethod
    def from_settings(
        cls, settings: Settings, *, clock: Callable[[], float] = time.monotonic
    ) -> OutboundBudget:
        """Build a bucket per searchable service from the configured sizes.

        Args:
            settings: The API settings.
            clock: A monotonic clock, injected by tests.

        Returns:
            OutboundBudget: The budget for every service that searches in the app.
        """
        return cls(
            {
                Provider.APPLE_MUSIC: TokenBucket(
                    burst=settings.apple_music_search_burst,
                    per_second=settings.apple_music_search_requests_per_second,
                    clock=clock,
                ),
                Provider.TIDAL: TokenBucket(
                    burst=settings.tidal_search_burst,
                    per_second=settings.tidal_search_requests_per_second,
                    clock=clock,
                ),
                Provider.INTERNET_ARCHIVE: TokenBucket(
                    burst=settings.internet_archive_search_burst,
                    per_second=settings.internet_archive_search_requests_per_second,
                    clock=clock,
                ),
            }
        )

    def spend(self, provider: Provider) -> None:
        """Spend one request to the service, before it is sent.

        Args:
            provider: The service about to be called.

        Raises:
            OverBudgetError: If the service's bucket is empty.
        """
        bucket = self._buckets.get(provider)
        if bucket is not None and not bucket.take():
            msg = f"no outbound budget left for {provider.value}"
            raise OverBudgetError(msg)


# No bucket for any service, for an adapter called outside the app.
UNLIMITED = OutboundBudget({})


# What one search costs each service in outbound requests, before any region fallback.
# TIDAL looks up the found tracks' artists in a second request.
REQUESTS_PER_SEARCH: dict[Provider, int] = {Provider.TIDAL: 2}


def search_cost(providers: list[Provider], inline: Container[Provider]) -> int:
    """Return what a search costs its caller's limit: the outbound requests it expects.

    A search that calls no service still costs one, so a caller cannot send unlimited
    requests to the route itself.

    Args:
        providers: The requested services, possibly repeated.
        inline: The services that search in the app.

    Returns:
        int: The expected outbound requests, at least one.
    """
    called = {p for p in providers if p in inline}
    return max(1, sum(REQUESTS_PER_SEARCH.get(p, 1) for p in called))
