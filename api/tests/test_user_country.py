"""A sync records the country of the request, at the same pace as the last-sync time."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from crosstune.db.base import utc_now
from crosstune.geo import COUNTRY_HEADER
from crosstune.models import User

pytestmark = pytest.mark.anyio


async def sync(client, headers, country: str | None = None) -> None:
    extra = {COUNTRY_HEADER: country} if country else {}
    response = await client.get("/v1/sync/pull", headers={**headers, **extra})
    assert response.status_code == 200


async def current(verify_session) -> User:
    verify_session.expire_all()
    return await verify_session.scalar(select(User))


async def make_due(verify_session) -> None:
    await verify_session.execute(update(User).values(last_synced_at=utc_now().replace(year=2020)))
    await verify_session.commit()


async def test_sync_stores_the_header_country(client, auth_headers, verify_session) -> None:
    await sync(client, auth_headers("user_a"), "DE")
    assert (await current(verify_session)).country == "DE"


async def test_sync_within_the_hour_writes_nothing(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    await sync(client, headers, "DE")
    await sync(client, headers, "FR")
    assert (await current(verify_session)).country == "DE"


async def test_due_sync_without_country_keeps_it(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    await sync(client, headers, "DE")
    await make_due(verify_session)
    await sync(client, headers)
    assert (await current(verify_session)).country == "DE"


async def test_due_sync_with_new_country_replaces_it(client, auth_headers, verify_session) -> None:
    headers = auth_headers("user_a")
    await sync(client, headers, "DE")
    await make_due(verify_session)
    await sync(client, headers, "FR")
    assert (await current(verify_session)).country == "FR"
