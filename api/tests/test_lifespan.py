"""App startup builds its own engine and http client when the caller has not injected them, and tears down only what it built."""

from __future__ import annotations

import httpx2
import pytest
from sqlalchemy import text

from crosstune.config import Settings
from crosstune.db.engine import make_sessionmaker
from crosstune.main import create_app

pytestmark = pytest.mark.anyio


async def test_lifespan_builds_and_disposes_its_own_engine(database_url: str) -> None:
    """No engine injected: lifespan builds one from settings and tears it down on exit."""
    app = create_app(Settings(database_url=database_url))

    async with app.router.lifespan_context(app):
        assert app.state.engine is not None
        assert app.state.sessionmaker is not None
        pool_during_lifespan = app.state.engine.pool
        built_engine = app.state.engine

    # dispose() swaps in a fresh pool instance; a different pool proves it ran.
    assert built_engine.pool is not pool_during_lifespan


async def test_lifespan_leaves_an_injected_engine_undisposed(database_url: str, engine) -> None:
    """An engine injected before startup outlives the lifespan, for its owner to dispose."""
    app = create_app(Settings(database_url=database_url))
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)

    pool_before = engine.pool
    async with app.router.lifespan_context(app):
        pass

    assert engine.pool is pool_before
    async with engine.connect() as conn:
        result = await conn.execute(text("select 1"))
        assert result.scalar_one() == 1


async def test_lifespan_builds_and_closes_its_own_http_client(database_url: str) -> None:
    """No http client injected: lifespan builds one and closes it on exit."""
    app = create_app(Settings(database_url=database_url))

    async with app.router.lifespan_context(app):
        assert app.state.http_client is not None
        assert app.state.jwks is not None
        built_client = app.state.http_client

    assert built_client.is_closed


async def test_lifespan_leaves_an_injected_http_client_open(database_url: str) -> None:
    """An http client injected before startup outlives the lifespan, for its owner to close."""
    app = create_app(Settings(database_url=database_url))
    client = httpx2.AsyncClient()
    app.state.http_client = client

    async with app.router.lifespan_context(app):
        pass

    assert not client.is_closed
    await client.aclose()
