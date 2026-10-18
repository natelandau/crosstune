"""GET /v1/region answers whether analytics must start off for the caller."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from crosstune.geo import COUNTRY_HEADER
from crosstune.vocabulary import CONSENT_COUNTRIES

pytestmark = pytest.mark.anyio

if TYPE_CHECKING:
    import httpx2


@pytest.mark.parametrize(
    ("code", "required"),
    [("DE", True), ("NO", True), ("US", False), ("GB", False)],
)
async def test_region_reports_consent_by_country(
    client: httpx2.AsyncClient, code: str, *, required: bool
) -> None:
    response = await client.get("/v1/region", headers={COUNTRY_HEADER: code})
    assert response.status_code == 200
    assert response.json() == {"country": code, "consent_required": required}


async def test_region_is_null_when_country_unknown(client: httpx2.AsyncClient) -> None:
    response = await client.get("/v1/region")
    assert response.status_code == 200
    assert response.json() == {"country": None, "consent_required": None}


class _FixedReader:
    def __init__(self, code: str) -> None:
        self.code = code
        self.asked: list[str] = []

    def country(self, ip: str) -> str | None:
        self.asked.append(ip)
        return self.code


async def test_region_falls_back_to_the_callers_ip(client: httpx2.AsyncClient, app) -> None:
    reader = _FixedReader("fr")
    app.state.geo = reader
    response = await client.get("/v1/region", headers={"x-real-ip": "203.0.113.7"})
    assert response.json() == {"country": "FR", "consent_required": True}
    assert reader.asked == ["203.0.113.7"]


async def test_region_is_never_cached(client: httpx2.AsyncClient) -> None:
    response = await client.get("/v1/region", headers={COUNTRY_HEADER: "DE"})
    assert response.headers["cache-control"] == "no-store"


def test_consent_countries_are_the_eu_and_eea() -> None:
    eu = {
        "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT",
        "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
    }  # fmt: skip
    assert len(eu) == 27
    assert eu | {"IS", "LI", "NO"} == CONSENT_COUNTRIES
