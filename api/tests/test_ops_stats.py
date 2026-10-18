"""The country-count operator command."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anyio.to_thread
import pytest

from crosstune.db.base import new_uuid7
from crosstune.models import Entitlement, Grant, User
from crosstune.ops import stats
from crosstune.ops.stats import CountryRow

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

NOW = datetime(2027, 3, 1, 9, 0, tzinfo=UTC)


async def _user(
    session: AsyncSession,
    country: str | None,
    *,
    synced_days_ago: int | None = None,
    premium_source: str | None = None,
    premium_expires_at: datetime | None = None,
) -> None:
    user = User(
        id=new_uuid7(),
        clerk_user_id=f"user_{new_uuid7().hex[-12:]}",
        country=country,
        created_at=NOW - timedelta(days=90),
        last_synced_at=None if synced_days_ago is None else NOW - timedelta(days=synced_days_ago),
    )
    session.add(user)
    await session.flush()
    session.add(
        Entitlement(
            user_id=user.id,
            premium_source=premium_source,
            premium_expires_at=premium_expires_at,
            premium_quota_bytes=0,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    await session.flush()


async def _seed(session: AsyncSession) -> None:
    await _user(session, "DE", synced_days_ago=2, premium_source="comp")
    await _user(
        session,
        "DE",
        synced_days_ago=20,
        premium_source="comp",
        premium_expires_at=NOW - timedelta(days=1),
    )
    await _user(session, "DE", synced_days_ago=60)
    await _user(
        session,
        "FR",
        synced_days_ago=5,
        premium_source="stripe",
        premium_expires_at=NOW + timedelta(days=9),
    )
    await _user(session, "US", synced_days_ago=1)
    await _user(session, None)
    await _user(session, None, synced_days_ago=3)


async def test_country_counts_per_country(session: AsyncSession) -> None:
    await _seed(session)

    rows = await stats.country_counts(session, NOW, 30)

    assert rows == [
        CountryRow("DE", 3, 1, 2, 1),
        CountryRow("FR", 1, 1, 1, 1),
        CountryRow("US", 1, 1, 1, 0),
        CountryRow(None, 2, 1, 1, 0),
    ]


async def test_active_window_follows_the_argument(session: AsyncSession) -> None:
    await _seed(session)

    rows = await stats.country_counts(session, NOW, 90)

    assert next(r for r in rows if r.country == "DE").active_n == 3


async def test_table_totals_the_eu_and_eea_and_everyone(session: AsyncSession) -> None:
    await _seed(session)
    rows = await stats.country_counts(session, NOW, 30)

    lines = stats.format_table(rows, 30).splitlines()

    assert lines[0].split() == ["country", "accounts", "active", "7d", "active", "30d", "premium"]
    assert lines[-3].split() == ["unknown", "2", "1", "1", "0"]
    assert lines[-2].split() == ["EU", "and", "EEA", "4", "2", "3", "2"]
    assert lines[-1].split() == ["All", "7", "4", "5", "2"]


async def test_main_prints_the_table_without_yes(
    settings: Settings,
    verify_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(stats, "load_settings", lambda: settings)
    await _user(verify_session, "DE")
    await verify_session.commit()

    code = await anyio.to_thread.run_sync(stats.main, ["countries"])

    out = capsys.readouterr().out
    assert code == 0
    assert out.startswith("environment ")
    assert "EU and EEA" in out
    assert out.rstrip().endswith("Withdrawals refunded but not cancelled: 0")


async def _paid_grant(
    session: AsyncSession,
    external_id: str,
    *,
    refunded_at: datetime | None = None,
    withdrawn_at: datetime | None = None,
) -> None:
    user_id = new_uuid7()
    session.add(User(id=user_id, clerk_user_id=f"user_{external_id}", created_at=NOW))
    await session.flush()
    session.add(
        Grant(
            user_id=user_id,
            kind="premium",
            source="stripe",
            external_id=external_id,
            refunded_at=refunded_at,
            withdrawn_at=withdrawn_at,
        )
    )
    await session.flush()


async def test_counts_withdrawals_refunded_but_not_cancelled(session: AsyncSession) -> None:
    await _paid_grant(session, "sub_live")
    await _paid_grant(session, "sub_stuck", refunded_at=NOW)
    await _paid_grant(session, "sub_done", refunded_at=NOW, withdrawn_at=NOW)

    assert await stats.refunded_not_cancelled(session) == 1
