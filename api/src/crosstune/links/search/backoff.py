"""Stop calling a music service for as long as it asked us to wait."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

from crosstune.rest import RateLimitHold

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from crosstune.vocabulary import Provider


class Backoff:
    """The music services that rate-limited the app, each with its own hold."""

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._holds: dict[Provider, RateLimitHold] = {}

    def _hold_of(self, provider: Provider) -> RateLimitHold:
        return self._holds.setdefault(provider, RateLimitHold(clock=self._clock))

    def hold(self, provider: Provider, seconds: float) -> None:
        """Leave the service alone for the given number of seconds from now."""
        self._hold_of(provider).hold(seconds)

    def hold_if_limited(self, provider: Provider, error: httpx2.HTTPStatusError) -> float | None:
        """Hold the service for its Retry-After when the error is a 429.

        Returns:
            float | None: The seconds held, or None when the error is not a rate limit.
        """
        return self._hold_of(provider).hold_if_limited(error.response)

    def held(self, provider: Provider) -> bool:
        """Whether the service is still waiting out a limit."""
        hold = self._holds.get(provider)
        return hold is not None and hold.held
