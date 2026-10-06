"""Stop calling a music service for as long as it asked us to wait."""

from __future__ import annotations

import time
from typing import TYPE_CHECKING

import httpx2

if TYPE_CHECKING:
    from collections.abc import Callable

    from crosstune.vocabulary import Provider

# A service that limits us without saying for how long is left alone for a minute.
DEFAULT_WAIT_SECONDS = 60.0
# A longer wait than this is most likely a misreported header, not a real ban.
MAX_WAIT_SECONDS = 300.0


def wait_seconds(retry_after: str | None) -> float:
    """Read a Retry-After header as seconds, kept within the default and the cap.

    Args:
        retry_after: The header's value, if any. Only the seconds form is read.

    Returns:
        float: Seconds to leave the service alone.
    """
    value = (retry_after or "").strip()
    # isdigit alone passes digits such as "²" that float() refuses.
    if not (value.isascii() and value.isdigit()):
        return DEFAULT_WAIT_SECONDS
    return min(max(float(value), 1.0), MAX_WAIT_SECONDS)


class Backoff:
    """The services that rate-limited the app, and when each may be called again.

    Every user's search shares one credential per service, so one 429 holds the service for
    everyone in this process. Calling it again before then only extends the limit.
    """

    def __init__(self, *, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._until: dict[Provider, float] = {}

    def hold(self, provider: Provider, seconds: float) -> None:
        """Leave the service alone for the given number of seconds from now."""
        self._until[provider] = max(self._until.get(provider, 0.0), self._clock() + seconds)

    def hold_if_limited(self, provider: Provider, error: httpx2.HTTPStatusError) -> float | None:
        """Hold the service for its Retry-After when the error is a 429.

        Returns:
            float | None: The seconds held, or None when the error is not a rate limit.
        """
        if error.response.status_code != httpx2.codes.TOO_MANY_REQUESTS:
            return None
        seconds = wait_seconds(error.response.headers.get("Retry-After"))
        self.hold(provider, seconds)
        return seconds

    def held(self, provider: Provider) -> bool:
        """Whether the service is still waiting out a limit."""
        until = self._until.get(provider)
        if until is None:
            return False
        if self._clock() >= until:
            del self._until[provider]
            return False
        return True
