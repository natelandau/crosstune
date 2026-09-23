"""The interactive docs and the schema are served only to local and development work."""

from __future__ import annotations

import httpx2
import pytest

from crosstune.config import Settings
from crosstune.main import create_app

pytestmark = pytest.mark.anyio

DOC_PATHS = ("/docs", "/redoc", "/openapi.json")


async def _statuses(settings: Settings) -> list[int]:
    app = create_app(settings)
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        return [(await client.get(path)).status_code for path in DOC_PATHS]


@pytest.mark.parametrize("environment", ["production", "pr-6"])
async def test_a_hosted_environment_serves_no_docs(environment: str) -> None:
    assert await _statuses(Settings(environment=environment)) == [404, 404, 404]


async def test_development_serves_the_docs() -> None:
    assert await _statuses(Settings(environment="development")) == [200, 200, 200]


def test_the_contract_is_still_generated_where_the_docs_are_hidden() -> None:
    app = create_app(Settings(environment="production"))
    assert "/v1/sync/push" in app.openapi()["paths"]
