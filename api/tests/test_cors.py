"""CORS admits the listed origins and any origin matching the regex, and nothing else."""

import httpx2
import pytest

from crosstune.config import Settings
from crosstune.main import create_app

pytestmark = pytest.mark.anyio

PREVIEW_REGEX = r"^https://[a-z0-9-]+\.crosstune\.pages\.dev$"


async def _preflight(settings: Settings, origin: str) -> httpx2.Response:
    """Send a CORS preflight request for the given origin and return the response."""
    app = create_app(settings)
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="http://testclient"
    ) as client:
        return await client.options(
            "/v1/sync/push",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization,content-type",
            },
        )


async def test_listed_origin_is_allowed(settings: Settings) -> None:
    """Origins in the explicit list pass the preflight check."""
    response = await _preflight(settings, "http://testclient")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://testclient"


async def test_origin_matching_the_regex_is_allowed(settings: Settings) -> None:
    """An origin matching the regex passes even when it is not in the list."""
    preview = settings.model_copy(update={"cors_origin_regex": PREVIEW_REGEX})
    response = await _preflight(preview, "https://abc123.crosstune.pages.dev")
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://abc123.crosstune.pages.dev"


async def test_unlisted_origin_is_refused(settings: Settings) -> None:
    """An origin matching neither the list nor the regex is refused."""
    preview = settings.model_copy(update={"cors_origin_regex": PREVIEW_REGEX})
    response = await _preflight(preview, "https://evil.example")
    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


async def test_regex_alone_enables_cors(settings: Settings) -> None:
    """The regex alone is enough to enable CORS, with no explicit origins listed."""
    only_regex = settings.model_copy(
        update={"cors_origins": [], "cors_origin_regex": PREVIEW_REGEX}
    )
    response = await _preflight(only_regex, "https://feature-x.crosstune.pages.dev")
    assert response.status_code == 200
