"""Per-caller request limits, counted in process memory."""

from __future__ import annotations

import time
from collections import deque
from contextlib import contextmanager
from typing import TYPE_CHECKING

from crosstune.errors import UserBusyError

if TYPE_CHECKING:
    import uuid
    from collections.abc import Callable, Generator, Hashable

    from fastapi import Request


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
        self._last_sweep = clock()

    @property
    def tracked(self) -> int:
        """How many keys the limiter holds hits for.

        A key idle for a window is dropped at the first sweep after that, and a sweep runs on
        the first hit a window or more after the one before it.
        """
        return len(self._hits)

    def hit(self, key: Hashable, cost: int = 1) -> float | None:
        """Count `cost` hits for `key` if they all fit under the limit.

        Args:
            key: Who is hitting, such as a user id.
            cost: How many hits one request counts as, for a request whose price varies.
                A cost above the limit counts as the whole limit.

        Returns:
            float | None: None when the hits are allowed and counted, otherwise the seconds
            until enough counted hits leave the window for this cost to fit.
        """
        cost = min(cost, self._limit)
        now = self._clock()
        cutoff = now - self._window
        # Sweeping once per window rather than per hit keeps a hit's cost independent of
        # how many keys are active, while memory stays bounded by two windows of callers.
        if now - self._last_sweep >= self._window:
            self._sweep(cutoff)
            self._last_sweep = now
        hits = self._hits.setdefault(key, deque())
        _prune(hits, cutoff)
        over = len(hits) + cost - self._limit
        if over > 0:
            return hits[over - 1] + self._window - now
        hits.extend([now] * cost)
        return None

    def _sweep(self, cutoff: float) -> None:
        for key in list(self._hits):
            hits = self._hits[key]
            _prune(hits, cutoff)
            if not hits:
                del self._hits[key]


def _prune(hits: deque[float], cutoff: float) -> None:
    while hits and hits[0] <= cutoff:
        hits.popleft()


class ConcurrencyLimiter:
    """Allow each key a fixed number of requests in flight at once, counted in process memory.

    A request that waits on its account's lock holds a pooled connection while it waits,
    so capping one account's requests in flight keeps it from holding every connection.
    """

    def __init__(self, *, limit: int) -> None:
        self._limit = limit
        self._held: dict[Hashable, int] = {}

    @property
    def tracked(self) -> int:
        """How many keys have a request in flight."""
        return len(self._held)

    def try_acquire(self, key: Hashable) -> bool:
        """Count one more request in flight for `key`, or return False when it is at the limit."""
        held = self._held.get(key, 0)
        if held >= self._limit:
            return False
        self._held[key] = held + 1
        return True

    def release(self, key: Hashable) -> None:
        """Count one request for `key` as finished."""
        held = self._held.get(key, 0) - 1
        if held > 0:
            self._held[key] = held
        else:
            self._held.pop(key, None)


@contextmanager
def account_slot(request: Request, user_id: uuid.UUID) -> Generator[None]:
    """Count a request against its account's share of requests in flight.

    Every route a signed-in user calls that waits on the account's user or billing lock
    runs that wait inside this, so all of them draw on one budget per account.

    Raises:
        UserBusyError: When the account already has as many requests in flight as it may.
    """
    limiter = request.app.state.locking_request_limiter
    if not limiter.try_acquire(user_id):
        raise UserBusyError
    try:
        yield
    finally:
        limiter.release(user_id)
