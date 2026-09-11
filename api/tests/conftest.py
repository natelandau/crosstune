"""Shared fixtures. The database is migrated once per session and every test runs in a transaction that is rolled back."""

from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING

import asyncpg
import httpx2
import jwt
import pytest
from alembic import command
from alembic.config import Config
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.auth.jwks import JwksCache
from crosstune.config import Settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.main import create_app

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from fastapi import FastAPI
    from pytest_databases.docker.postgres import PostgresService

pytest_plugins = ("pytest_databases.docker.postgres",)


@pytest.fixture(scope="session")
def postgres_image() -> str:
    """Pin the version tests run against instead of tracking the plugin's default."""
    return "postgres:18"


@pytest.fixture(scope="session")
def anyio_backend() -> str:
    return "asyncio"


@pytest.fixture(scope="session")
def worker_id(request: pytest.FixtureRequest) -> str:
    if hasattr(request.config, "workerinput"):
        return request.config.workerinput["workerid"]
    return "master"


@pytest.fixture(scope="session")
def database_url(postgres_service: PostgresService, worker_id: str) -> str:
    """One migrated database per xdist worker."""
    db_name = f"crosstune_test_{worker_id}"

    async def create() -> None:
        conn = await asyncpg.connect(
            host=postgres_service.host,
            port=postgres_service.port,
            user=postgres_service.user,
            password=postgres_service.password,
            database="postgres",
        )
        try:
            await conn.execute(f'drop database if exists "{db_name}"')
            await conn.execute(f'create database "{db_name}"')
        finally:
            await conn.close()

    asyncio.run(create())
    url = (
        f"postgresql+asyncpg://{postgres_service.user}:{postgres_service.password}"
        f"@{postgres_service.host}:{postgres_service.port}/{db_name}"
    )
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", url)
    command.upgrade(cfg, "head")
    return url


@pytest.fixture
def settings(database_url: str) -> Settings:
    return Settings(database_url=database_url)


@pytest.fixture
async def engine(settings: Settings):
    engine = make_engine(settings.database_url)
    yield engine
    await engine.dispose()


@pytest.fixture
async def session(engine) -> AsyncIterator[AsyncSession]:
    """A session whose work is discarded after the test."""
    async with engine.connect() as conn:
        trans = await conn.begin()
        async with AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        ) as s:
            yield s
        await trans.rollback()


@pytest.fixture(scope="session")
def rsa_keypair():
    """One RSA key for the whole session. The public half is served as a JWKS."""
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return private, private.public_key()


@pytest.fixture(scope="session")
def jwks_document(rsa_keypair) -> dict:
    _, public = rsa_keypair
    jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(public))
    jwk["kid"] = "test-kid"
    jwk["use"] = "sig"
    jwk["alg"] = "RS256"
    return {"keys": [jwk]}


class MockHttp:
    """Routes outbound requests to canned responses by URL prefix."""

    def __init__(self) -> None:
        self.routes: dict[str, httpx2.Response] = {}
        self.calls: list[httpx2.Request] = []

    def add(self, url_prefix: str, response: httpx2.Response) -> None:
        self.routes[url_prefix] = response

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.calls.append(request)
        for prefix, response in self.routes.items():
            if str(request.url).startswith(prefix):
                return response
        return httpx2.Response(404, text="no mock route")

    def client(self) -> httpx2.AsyncClient:
        return httpx2.AsyncClient(transport=httpx2.MockTransport(self.handler))


@pytest.fixture
def mock_http(settings: Settings, jwks_document: dict) -> MockHttp:
    http = MockHttp()
    http.add(settings.clerk_jwks_url, httpx2.Response(200, json=jwks_document))
    return http


@pytest.fixture
def make_token(rsa_keypair, settings: Settings):
    private, _ = rsa_keypair

    def _make(clerk_user_id: str, kid: str = "test-kid", **overrides) -> str:
        now = int(time.time())
        claims = {
            "sub": clerk_user_id,
            "iss": settings.clerk_issuer,
            "azp": settings.clerk_authorized_parties[0],
            "iat": now,
            "nbf": now - 5,
            "exp": now + 60,
            "sid": "sess_test",
        }
        claims.update(overrides)
        return jwt.encode(claims, private, algorithm="RS256", headers={"kid": kid})

    return _make


@pytest.fixture
def auth_headers(make_token):
    def _headers(clerk_user_id: str) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(clerk_user_id)}"}

    return _headers


@pytest.fixture
async def verify_session(engine) -> AsyncIterator[AsyncSession]:
    """A committed-view session for asserting what the API wrote."""
    async with AsyncSession(bind=engine, expire_on_commit=False) as s:
        yield s


@pytest.fixture
async def truncate_all(engine) -> AsyncIterator[None]:
    """Wipe every table after each test so API writes never leak between tests."""
    yield
    async with engine.begin() as conn:
        await conn.execute(
            text("truncate list_items, lists, recording_links, user_songs, songs, users cascade")
        )


@pytest.fixture
def app(settings: Settings, engine, mock_http: MockHttp) -> FastAPI:
    app = create_app(settings)
    app.state.engine = engine
    app.state.sessionmaker = make_sessionmaker(engine)
    app.state.http_client = mock_http.client()
    app.state.jwks = JwksCache(settings.clerk_jwks_url, app.state.http_client)
    return app


@pytest.fixture
async def client(app: FastAPI, truncate_all: None) -> AsyncIterator[httpx2.AsyncClient]:
    """The only fixture that writes committed rows, so it is the one that must clean up."""
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as c:
        yield c
