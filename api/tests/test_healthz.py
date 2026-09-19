"""Health endpoint."""

import httpx2
import pytest

from crosstune.config import Settings
from crosstune.main import create_app

pytestmark = pytest.mark.anyio


async def test_healthz_returns_ok(client: httpx2.AsyncClient) -> None:
    response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_healthz_names_a_database_the_e2e_suite_owns() -> None:
    """The end-to-end suite reads this to refuse an API bound to anything else."""
    app = create_app(
        Settings(database_url="postgresql+asyncpg://crosstune:crosstune@localhost:5432/x_e2e")
    )
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        response = await client.get("/healthz")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "x_e2e"}
