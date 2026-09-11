"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import httpx2
import sentry_sdk
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from crosstune import __version__
from crosstune.auth.jwks import JwksCache
from crosstune.config import Settings, get_settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.errors import install_error_handlers
from crosstune.links.router import router as links_router
from crosstune.logging import configure_logging
from crosstune.sync.router import router as sync_router
from crosstune.users.router import router as users_router

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = app.state.settings
    # Tests inject these before startup; only build (and later tear down) what is absent,
    # so an injected resource outlives the lifespan under whoever owns it.
    built_engine = app.state.engine is None
    if built_engine:
        app.state.engine = make_engine(settings.database_url)
        app.state.sessionmaker = make_sessionmaker(app.state.engine)
    built_http_client = app.state.http_client is None
    if built_http_client:
        app.state.http_client = httpx2.AsyncClient(
            timeout=settings.resolver_timeout_seconds, follow_redirects=True
        )
    if app.state.jwks is None:
        app.state.jwks = JwksCache(settings.clerk_jwks_url, app.state.http_client)
    yield
    if built_http_client:
        await app.state.http_client.aclose()
    if built_engine:
        await app.state.engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. Tests pass explicit settings and inject state."""
    settings = settings or get_settings()
    configure_logging(debug=settings.debug)
    if settings.sentry_dsn:
        sentry_sdk.init(dsn=settings.sentry_dsn, release=__version__, traces_sample_rate=0.0)

    app = FastAPI(
        title="Crosstune API", version=__version__, debug=settings.debug, lifespan=_lifespan
    )
    app.state.settings = settings
    app.state.engine = None
    app.state.sessionmaker = None
    app.state.http_client = None
    app.state.jwks = None

    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_methods=["GET", "POST", "OPTIONS"],
            allow_headers=["*"],
        )

    install_error_handlers(app)
    app.include_router(users_router)
    app.include_router(sync_router)
    app.include_router(links_router)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
