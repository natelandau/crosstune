"""The idle pool closer drops database connections nobody is using."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import text

from crosstune.db.engine import IdlePoolCloser, make_engine

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.anyio


class FakeClock:
    """A monotonic clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


@pytest.fixture
async def own_engine(database_url: str) -> AsyncIterator[AsyncEngine]:
    """An engine of its own, since these tests dispose its pool."""
    engine = make_engine(database_url)
    yield engine
    await engine.dispose()


async def _use(engine: AsyncEngine) -> None:
    async with engine.connect() as conn:
        await conn.execute(text("select 1"))


async def test_disposes_after_idle(own_engine) -> None:
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    await _use(own_engine)
    clock.now += 121
    assert await closer.check() is True
    assert own_engine.pool.checkedin() == 0


async def test_does_not_dispose_inside_the_window(own_engine) -> None:
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    await _use(own_engine)
    clock.now += 119
    assert await closer.check() is False
    assert own_engine.pool.checkedin() == 1


async def test_does_not_dispose_while_checked_out(own_engine) -> None:
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    async with own_engine.connect() as conn:
        await conn.execute(text("select 1"))
        clock.now += 300
        assert await closer.check() is False


async def test_a_checkin_resets_the_timer(own_engine) -> None:
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    await _use(own_engine)
    clock.now += 100
    await _use(own_engine)
    clock.now += 100
    assert await closer.check() is False


async def test_still_tracks_after_dispose(own_engine) -> None:
    """dispose() swaps in a new pool; the closer must keep seeing its traffic."""
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    await _use(own_engine)
    clock.now += 121
    assert await closer.check() is True
    async with own_engine.connect() as conn:
        await conn.execute(text("select 1"))
        clock.now += 300
        assert await closer.check() is False
    clock.now += 100
    assert await closer.check() is False
    clock.now += 21
    assert await closer.check() is True


async def test_nothing_to_close_is_not_a_dispose(own_engine) -> None:
    clock = FakeClock()
    closer = IdlePoolCloser(own_engine, clock=clock)
    clock.now += 300
    assert await closer.check() is False


async def test_start_and_stop(own_engine) -> None:
    closer = IdlePoolCloser(own_engine, check_seconds=3600)
    task = closer.start()
    await closer.stop()
    assert task.done()
