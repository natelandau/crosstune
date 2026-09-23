"""Per-caller request limits, counted in process memory."""

from __future__ import annotations

import time
from collections import deque
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Hashable


class RateLimiter:
    """Allow each key a fixed number of hits in any sliding window, for routes that cost money.

    The count lives in this process, which is exact while the API runs as one replica and
    per-replica beyond that.
    """

    def __init__(
        self,
        *,
        limit: int,
        window_seconds: float,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._limit = limit
        self._window = window_seconds
        self._clock = clock
        self._hits: dict[Hashable, deque[float]] = {}

    @property
    def tracked(self) -> int:
        """How many keys have a hit still inside the window."""
        return len(self._hits)

    def hit(self, key: Hashable) -> float | None:
        """Count a hit for `key` if it is under the limit.

        Args:
            key: Who is hitting, such as a user id.

        Returns:
            float | None: None when the hit is allowed and counted, otherwise the seconds
            until the oldest counted hit leaves the window and one more is allowed.
        """
        now = self._clock()
        self._forget(now)
        hits = self._hits.setdefault(key, deque())
        if len(hits) >= self._limit:
            return hits[0] + self._window - now
        hits.append(now)
        return None

    def _forget(self, now: float) -> None:
        # Pruning every key on every hit keeps memory bounded by active callers, and the
        # key count is small enough that the sweep costs nothing next to the route itself.
        cutoff = now - self._window
        for key in list(self._hits):
            hits = self._hits[key]
            while hits and hits[0] <= cutoff:
                hits.popleft()
            if not hits:
                del self._hits[key]
