"""FastAPI application factory."""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import sentry_sdk
from fastapi import FastAPI

from crosstune import __version__
from crosstune.auth.jwks import JwksCache
from crosstune.body import BodyAdmission
from crosstune.config import Settings, get_settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.errors import install_error_handlers
from crosstune.http import public_only_client
from crosstune.jobs.runner import JobRunner
from crosstune.links.router import router as links_router
from crosstune.logging import configure_logging
from crosstune.ratelimit import RateLimiter
from crosstune.recordings.router import router as recordings_router
from crosstune.schemas.rows import RecordingData
from crosstune.storage.prefixed import PrefixedStore
from crosstune.storage.r2 import R2Store
from crosstune.sync.router import router as sync_router
from crosstune.users.clerk import ClerkBackendUsers
from crosstune.users.router import router as users_router

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from crosstune.storage.store import ObjectStore


def _build_clerk_users(app: FastAPI, settings: Settings) -> None:
    """Set app.state.clerk_users when a secret key is configured and nothing built it yet."""
    if app.state.clerk_users is None and settings.clerk_secret_key.get_secret_value():
        app.state.clerk_users = ClerkBackendUsers(
            app.state.http_client, settings.clerk_secret_key.get_secret_value()
        )


def _publish_recording_data_schema(app: FastAPI) -> None:
    """Add RecordingData to the document under its own name.

    A push's `data` field is typed as a plain object because each table validates its
    own shape by hand, so FastAPI's route walk never reaches RecordingData on its own;
    the client generators still need it named and published, to read the speed and
    pitch ranges vocabulary.py declares.
    """
    generate = app.openapi

    def openapi() -> dict[str, Any]:
        first_build = app.openapi_schema is None
        schema = generate()
        if first_build:
            schemas = schema["components"]["schemas"]
            model_schema = RecordingData.model_json_schema(
                ref_template="#/components/schemas/{model}"
            )
            # setdefault, never overwrite: RecordingData's own schema is built in
            # validation mode, which shapes an optional nested field differently than
            # the serialization mode a route's response model uses, so filling in a
            # $def the document already has would reshape a schema other rows share.
            for name, definition in model_schema.pop("$defs", {}).items():
                schemas.setdefault(name, definition)
            schemas["RecordingData"] = model_schema
        return schema

    # Replacing the generator on the instance is FastAPI's documented extension point.
    app.openapi = openapi  # ty: ignore[invalid-assignment]


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
        app.state.http_client = public_only_client(settings.link_resolve_timeout_seconds)
    if app.state.jwks is None:
        app.state.jwks = JwksCache(settings.clerk_jwks_url, app.state.http_client)
    _build_clerk_users(app, settings)
    if app.state.object_store is None and settings.storage_configured:
        store: ObjectStore = R2Store(
            endpoint_url=settings.storage_endpoint,
            bucket=settings.storage_bucket,
            access_key_id=settings.storage_access_key_id,
            secret_access_key=settings.storage_secret_access_key.get_secret_value(),
            browser_endpoint_url=settings.local_storage_browser_endpoint_url,
        )
        if settings.storage_prefix:
            store = PrefixedStore(store, settings.storage_prefix)
        app.state.object_store = store
    built_runner = app.state.job_runner is None and app.state.object_store is not None
    if built_runner:
        app.state.job_runner = JobRunner(
            app.state.sessionmaker,
            app.state.object_store,
            orphan_sweep_seconds=settings.orphan_sweep_seconds,
        )
        app.state.job_runner.start()
    try:
        yield
    finally:
        # An exception raised into this generator (a startup failure elsewhere,
        # a test tearing down early), or out of one teardown step, must still
        # release everything else that was built above.
        try:
            if built_runner:
                await app.state.job_runner.stop()
        finally:
            try:
                if built_http_client:
                    await app.state.http_client.aclose()
            finally:
                if built_engine:
                    await app.state.engine.dispose()


def create_app(settings: Settings | None = None) -> FastAPI:
    """Build the application. Tests pass explicit settings and inject state."""
    settings = settings or get_settings()
    configure_logging(debug=settings.debug)
    if settings.sentry_dsn:
        sentry_sdk.init(
            dsn=settings.sentry_dsn,
            release=__version__,
            environment=settings.environment,
            traces_sample_rate=0.0,
        )

    # The committed contract is generated from app.openapi(), which needs none of these routes.
    docs = settings.environment == "development"
    app = FastAPI(
        title="Crosstune API",
        version=__version__,
        debug=settings.debug,
        lifespan=_lifespan,
        docs_url="/docs" if docs else None,
        redoc_url="/redoc" if docs else None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.settings = settings
    app.state.engine = None
    app.state.sessionmaker = None
    app.state.http_client = None
    app.state.jwks = None
    app.state.clerk_users = None
    app.state.object_store = None
    app.state.job_runner = None
    app.state.link_resolve_limiter = RateLimiter(
        limit=settings.link_resolves_per_minute, window_seconds=60.0
    )

    install_error_handlers(app)
    app.add_middleware(BodyAdmission)
    app.include_router(users_router)
    app.include_router(sync_router)
    app.include_router(links_router)
    app.include_router(recordings_router)
    _publish_recording_data_schema(app)

    @app.get("/healthz", include_in_schema=False)
    async def healthz() -> dict[str, str]:
        # A database the end-to-end suite owns names itself, so `just web::e2e` can tell
        # which database the API on :8000 is bound to. Every other database is never named.
        if settings.e2e_database:
            return {"status": "ok", "database": settings.database_name}
        return {"status": "ok"}

    return app


app = create_app()
