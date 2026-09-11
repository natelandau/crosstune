"""Engine and session factory construction."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)


def make_engine(url: str) -> AsyncEngine:
    """Async engine with pre-ping so a suspended Neon compute reconnects cleanly."""
    return create_async_engine(url, pool_pre_ping=True)


def make_sessionmaker(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Session factory bound to the engine."""
    return async_sessionmaker(engine, expire_on_commit=False)
