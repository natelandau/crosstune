"""App startup builds its own engine and http client when the caller has not injected them, and tears down only what it built."""

from __future__ import annotations

import httpx2
import pytest
from sqlalchemy import text

from crosstune.config import Settings
from crosstune.db.engine import make_sessionmaker
from crosstune.main import create_app
from crosstune.storage.r2 import R2Store
from tests.fakes import FakeObjectStore

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


async def test_lifespan_leaves_object_store_none_without_r2_settings(database_url: str) -> None:
    """With no R2 settings configured, lifespan leaves the object store and runner unbuilt."""
    app = create_app(Settings(database_url=database_url))

    async with app.router.lifespan_context(app):
        assert app.state.object_store is None
        assert app.state.job_runner is None


async def test_lifespan_builds_an_r2_store_when_configured(database_url: str) -> None:
    """With all four R2 settings present, lifespan builds an R2Store."""
    app = create_app(
        Settings(
            database_url=database_url,
            r2_account_id="acct",
            r2_bucket="crosstune-test",
            r2_access_key_id="test-access-key",  # gitleaks:allow -- fixture, not a credential
            r2_secret_access_key="test-secret",  # gitleaks:allow -- fixture, not a credential
        )
    )

    async with app.router.lifespan_context(app):
        assert isinstance(app.state.object_store, R2Store)


async def test_lifespan_leaves_an_injected_object_store_in_place(database_url: str) -> None:
    """An object store injected before startup outlives the lifespan untouched."""
    app = create_app(Settings(database_url=database_url))
    fake = FakeObjectStore()
    app.state.object_store = fake

    async with app.router.lifespan_context(app):
        assert app.state.object_store is fake

    assert app.state.object_store is fake


async def test_lifespan_runs_and_stops_the_runner_with_an_injected_store(database_url: str) -> None:
    """A store present at startup gets a runner that starts before yield and stops after."""
    app = create_app(Settings(database_url=database_url, job_poll_seconds=0.01))
    app.state.object_store = FakeObjectStore()
    async with app.router.lifespan_context(app):
        assert app.state.job_runner is not None
        assert not app.state.job_runner.task.done()
    assert app.state.job_runner.task.done()
