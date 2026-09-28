"""Engine and session factory construction."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from typing import TYPE_CHECKING, Any

from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

if TYPE_CHECKING:
    from collections.abc import Callable

log = logging.getLogger(__name__)

# Well under Railway's 5 minutes without outbound packets, after which a service sleeps.
IDLE_POOL_SECONDS = 120.0
IDLE_CHECK_SECONDS = 30.0


def make_engine(url: str) -> AsyncEngine:
    """Async engine with pre-ping so a suspended Neon compute reconnects cleanly."""
    return create_async_engine(url, pool_pre_ping=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Session factory bound to the engine."""
    return async_sessionmaker(engine, expire_on_commit=False)


class IdlePoolCloser:
    """Close pooled database connections nobody has used for a while.

    An open connection is outbound traffic to the host, so a pool that keeps one
    would stop the API from ever sleeping. The next query reconnects. The check
    itself sends nothing.
    """

    def __init__(
        self,
        engine: AsyncEngine,
        *,
        idle_seconds: float = IDLE_POOL_SECONDS,
        check_seconds: float = IDLE_CHECK_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self._engine = engine
        self._idle_seconds = idle_seconds
        self._check_seconds = check_seconds
        self._clock = clock
        self._last_used = clock()
        self._stopping = asyncio.Event()
        self.task: asyncio.Task[None] | None = None
        # On the engine, not its pool, so the listeners carry over to the pool
        # dispose() puts in its place.
        event.listen(engine.sync_engine, "checkout", self._touch)
        event.listen(engine.sync_engine, "checkin", self._touch)

    def _touch(self, *_: Any) -> None:
        self._last_used = self._clock()

    async def check(self) -> bool:
        """Dispose of the pool once no connection is in use and none has been for long enough.

        Returns:
            bool: True when this check closed the pooled connections.
        """
        pool: Any = self._engine.pool
        if pool.checkedout() > 0 or pool.checkedin() == 0:
            return False
        if self._clock() - self._last_used < self._idle_seconds:
            return False
        # Closes only checked-in connections; one checked out meanwhile is unaffected.
        await self._engine.dispose()
        return True

    def start(self) -> asyncio.Task[None]:
        """Run the checks as a task on the current event loop."""
        self.task = asyncio.create_task(self._run(), name="idle-pool-closer")
        return self.task

    async def stop(self) -> None:
        """End the checks and wait for the task to finish."""
        self._stopping.set()
        if self.task is not None:
            await self.task

    async def _run(self) -> None:
        while not self._stopping.is_set():
            with contextlib.suppress(TimeoutError):
                async with asyncio.timeout(self._check_seconds):
                    await self._stopping.wait()
            if self._stopping.is_set():
                return
            # A failed check must not end the task, or the pool stays open and the host never sleeps.
            try:
                await self.check()
            except Exception:
                log.exception("idle pool closer could not close the pool")
