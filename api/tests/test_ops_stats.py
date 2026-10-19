"""The country-count operator command."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anyio.to_thread
import pytest

from crosstune.db.base import new_uuid7
from crosstune.models import ClientVersionSighting, Entitlement, Grant, User
from crosstune.ops import stats
from crosstune.ops.stats import CountryRow, VersionRow

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


async def _sighting(
    session: AsyncSession, platform: str, version: str, *, seen_days_ago: int = 1
) -> None:
    user_id = new_uuid7()
    session.add(User(id=user_id, clerk_user_id=f"user_{user_id.hex[-12:]}", created_at=NOW))
    await session.flush()
    session.add(
        ClientVersionSighting(
            user_id=user_id,
            platform=platform,
            version=version,
            last_seen_at=NOW - timedelta(days=seen_days_ago),
        )
    )
    await session.flush()


async def _seed_versions(session: AsyncSession) -> None:
    await _sighting(session, "ios", "1.10.0")
    await _sighting(session, "ios", "1.10.0", seen_days_ago=29)
    await _sighting(session, "ios", "1.9.0")
    await _sighting(session, "macos", "1.2.0")
    await _sighting(session, "ios", "1.0.0", seen_days_ago=40)


async def test_version_counts_window_and_order(session: AsyncSession) -> None:
    await _seed_versions(session)

    rows = await stats.version_counts(session, NOW, 30, (1, 9, 0))

    assert [(r.platform, r.version, r.accounts, r.blocked) for r in rows] == [
        ("ios", "1.10.0", 2, False),
        ("ios", "1.9.0", 1, False),
        ("macos", "1.2.0", 1, True),
    ]


async def test_version_counts_never_block_web_or_without_a_floor(session: AsyncSession) -> None:
    await _sighting(session, "web", "0.1.0")
    await _sighting(session, "ios", "1.0.0")

    with_floor = await stats.version_counts(session, NOW, 30, (9, 0, 0))
    without_floor = await stats.version_counts(session, NOW, 30, None)

    assert [(r.platform, r.blocked) for r in with_floor] == [("ios", True), ("web", False)]
    assert not any(r.blocked for r in without_floor)


async def test_version_counts_put_unparsable_versions_last(session: AsyncSession) -> None:
    await _sighting(session, "ios", "garbage")
    await _sighting(session, "ios", "1.2.0")

    rows = await stats.version_counts(session, NOW, 30, (2, 0, 0))

    assert [(r.version, r.blocked) for r in rows] == [("1.2.0", True), ("garbage", False)]


def test_format_versions_names_the_floor() -> None:
    rows = [
        VersionRow("ios", "1.10.0", 2, blocked=False),
        VersionRow("ios", "1.9.0", 1, blocked=True),
        VersionRow("macos", "1.2.0", 4, blocked=False),
    ]

    lines = stats.format_versions(rows, 30, (1, 9, 5)).splitlines()

    assert lines[0] == "Apple minimum: 1.9.5"
    assert lines[1].split() == ["platform", "version", "active", "30d", "blocked"]
    assert lines[2].split() == ["ios", "1.10.0", "2"]
    assert lines[3].split() == ["ios", "1.9.0", "1", "yes"]
    assert lines[4].split() == ["macos", "1.2.0", "4"]
    assert lines[-2].split() == ["ios", "total", "3"]
    assert lines[-1].split() == ["macos", "total", "4"]
    assert stats.format_versions([], 30, None).splitlines()[0] == "Apple minimum: none"


async def test_main_prints_versions_without_yes(
    settings: Settings,
    verify_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    monkeypatch.setattr(stats, "load_settings", lambda: settings)
    await _sighting(verify_session, "ios", "1.4.0", seen_days_ago=0)
    await verify_session.commit()

    code = await anyio.to_thread.run_sync(stats.main, ["versions"])

    lines = capsys.readouterr().out.splitlines()
    assert code == 0
    assert lines[0].startswith("environment ")
    assert any(line.startswith("Apple minimum: ") for line in lines)
    assert any(line.split()[:2] == ["ios", "1.4.0"] for line in lines)
