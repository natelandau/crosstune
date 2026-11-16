"""The interactive docs and the schema are served only to development work on a local database."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.config import Settings
from crosstune.main import create_app
from tests.helpers import NEON

pytestmark = pytest.mark.anyio

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


async def _statuses(settings: Settings) -> list[int]:
    app = create_app(settings)
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        return [(await client.get(path)).status_code for path in DOC_PATHS]


@pytest.mark.parametrize(
    "hosted",
    [
        {"environment": "production"},
        {"environment": "pr-6"},
        {"environment": "development", "database_url": NEON},
    ],
    ids=["production", "pr", "development-on-a-remote-database"],
)
async def test_a_hosted_environment_serves_no_docs(hosted: dict[str, str]) -> None:
    assert await _statuses(Settings(**hosted)) == [404, 404, 404]


async def test_development_serves_the_docs() -> None:
    assert await _statuses(Settings(environment="development")) == [200, 200, 200]


def test_the_contract_is_still_generated_where_the_docs_are_hidden() -> None:
    app = create_app(Settings(environment="production"))
    assert "/v1/sync/push" in app.openapi()["paths"]
