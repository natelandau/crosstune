"""Access resolves from grants; the entitlements row changes only when the result does."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest

from crosstune.billing.access import access_for, refresh_entitlement, resolve, scan_tune_id
from crosstune.models import Grant, Scan, Tune, User
from crosstune.vocabulary import GrantKind, GrantSource
from tests.helpers import T0

if TYPE_CHECKING:
    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

NOW = T0
FREE = 52_428_800
TRIAL = 104_857_600
PREMIUM = 5_368_709_120
ADDON = 53_687_091_200


def _grant(kind: GrantKind, source: GrantSource, expires_at=None, *, auto_renews=False) -> Grant:
    return Grant(
        kind=kind.value, source=source.value, expires_at=expires_at, auto_renews=auto_renews
    )


def _premium(source: GrantSource, expires_at=None, *, auto_renews=False) -> Grant:
    return _grant(GrantKind.PREMIUM, source, expires_at, auto_renews=auto_renews)


def test_no_grants_is_free(settings: Settings) -> None:
    result = resolve([], NOW, settings)

    assert result.access.premium is False
    assert result.access.quota_bytes == FREE
    assert result.access.counts_recordings is False
    assert result.premium_source is None
    assert result.free_quota_bytes == FREE


def test_active_trial_is_premium_with_trial_quota(settings: Settings) -> None:
    ends = NOW + timedelta(days=5)
    result = resolve([_premium(GrantSource.TRIAL, ends)], NOW, settings)

    assert result.access.premium is True
    assert result.access.quota_bytes == TRIAL
    assert result.access.counts_recordings is True
    assert result.premium_source == GrantSource.TRIAL
    assert result.premium_expires_at == ends
    assert result.trial_ends_at == ends


def test_expired_trial_with_open_comp_reports_comp(settings: Settings) -> None:
    ended = NOW - timedelta(days=1)
    result = resolve(
        [_premium(GrantSource.TRIAL, ended), _premium(GrantSource.COMP)], NOW, settings
    )

    assert result.access.premium is True
    assert result.access.quota_bytes == PREMIUM
    assert result.premium_source == GrantSource.COMP
    assert result.premium_expires_at is None
    assert result.trial_ends_at == ended


def test_addon_adds_to_comp_quota(settings: Settings) -> None:
    result = resolve(
        [_premium(GrantSource.COMP), _grant(GrantKind.STORAGE_ADDON, GrantSource.COMP)],
        NOW,
        settings,
    )

    assert result.access.quota_bytes == PREMIUM + ADDON
    assert result.premium_quota_bytes == PREMIUM + ADDON


def test_addon_is_ignored_on_a_trial_alone(settings: Settings) -> None:
    result = resolve(
        [
            _premium(GrantSource.TRIAL, NOW + timedelta(days=1)),
            _grant(GrantKind.STORAGE_ADDON, GrantSource.COMP),
        ],
        NOW,
        settings,
    )

    assert result.access.quota_bytes == TRIAL


def test_expiry_at_now_is_not_active(settings: Settings) -> None:
    result = resolve([_premium(GrantSource.COMP, NOW)], NOW, settings)

    assert result.access.premium is False


def test_reported_grant_is_the_longest_lasting(settings: Settings) -> None:
    soon, later = NOW + timedelta(days=1), NOW + timedelta(days=9)
    dated = resolve(
        [
            _premium(GrantSource.APPLE, soon, auto_renews=True),
            _premium(GrantSource.COMP, later),
        ],
        NOW,
        settings,
    )
    assert dated.premium_source == GrantSource.COMP
    assert dated.premium_expires_at == later
    assert dated.auto_renews is False

    open_ended = resolve(
        [_premium(GrantSource.STRIPE, later, auto_renews=True), _premium(GrantSource.COMP)],
        NOW,
        settings,
    )
    assert open_ended.premium_source == GrantSource.COMP
    assert open_ended.premium_expires_at is None


def test_equal_expiry_prefers_billing_then_comp_then_trial(settings: Settings) -> None:
    ends = NOW + timedelta(days=3)
    grants = [
        _premium(GrantSource.TRIAL, ends),
        _premium(GrantSource.COMP, ends),
        _premium(GrantSource.APPLE, ends, auto_renews=True),
    ]

    assert resolve(grants, NOW, settings).premium_source == GrantSource.APPLE
    assert resolve(grants[:2], NOW, settings).premium_source == GrantSource.COMP


def test_a_comp_ending_before_the_trial_reports_the_trial_quota(settings: Settings) -> None:
    trial_ends = NOW + timedelta(days=20)
    result = resolve(
        [
            _premium(GrantSource.TRIAL, trial_ends),
            _premium(GrantSource.COMP, NOW + timedelta(days=2)),
            _grant(GrantKind.STORAGE_ADDON, GrantSource.COMP, NOW + timedelta(days=2)),
        ],
        NOW,
        settings,
    )

    assert result.premium_source == GrantSource.TRIAL
    assert result.premium_expires_at == trial_ends
    assert result.premium_quota_bytes == TRIAL
    assert result.access.quota_bytes == TRIAL


def test_a_comp_outlasting_the_trial_reports_the_premium_quota(settings: Settings) -> None:
    result = resolve(
        [
            _premium(GrantSource.TRIAL, NOW + timedelta(days=2)),
            _premium(GrantSource.COMP, NOW + timedelta(days=20)),
        ],
        NOW,
        settings,
    )

    assert result.premium_source == GrantSource.COMP
    assert result.premium_quota_bytes == PREMIUM
    assert result.access.quota_bytes == PREMIUM


def test_an_expired_trial_alone_is_free(settings: Settings) -> None:
    ended = NOW - timedelta(days=1)
    result = resolve([_premium(GrantSource.TRIAL, ended)], NOW, settings)

    assert result.access.premium is False
    assert result.access.quota_bytes == FREE
    assert result.premium_source is None
    assert result.premium_expires_at is None
    assert result.trial_ends_at == ended


async def _user(session) -> uuid.UUID:
    user = User(clerk_user_id=f"user_{uuid.uuid4().hex}")
    session.add(user)
    await session.flush()
    return user.id


async def test_access_for_reads_grants(session, settings: Settings) -> None:
    user_id = await _user(session)
    assert (await access_for(session, user_id, settings, NOW)).premium is False

    grant = _premium(GrantSource.COMP)
    grant.user_id = user_id
    session.add(grant)
    await session.flush()

    assert (await access_for(session, user_id, settings, NOW)).quota_bytes == PREMIUM


async def test_refresh_bumps_server_seq_only_on_change(session, settings: Settings) -> None:
    user_id = await _user(session)

    row = await refresh_entitlement(session, user_id, settings, NOW)
    first_seq = row.server_seq
    assert isinstance(first_seq, int)
    assert row.premium_source is None
    assert row.free_quota_bytes == FREE

    row = await refresh_entitlement(session, user_id, settings, NOW)
    assert row.server_seq == first_seq

    grant = _premium(GrantSource.COMP)
    grant.user_id = user_id
    session.add(grant)
    await session.flush()

    row = await refresh_entitlement(session, user_id, settings, NOW)
    assert isinstance(row.server_seq, int)
    assert row.server_seq > first_seq
    assert row.premium_source == "comp"
    assert row.premium_quota_bytes == PREMIUM


async def _tune_with_scan(
    session, user_id, created_at, *, deleted_at=None
) -> tuple[uuid.UUID, Scan]:
    tune_id = uuid.uuid4()
    session.add(
        Tune(
            id=tune_id,
            owner_user_id=user_id,
            title="X",
            created_at=created_at,
            updated_at=created_at,
        )
    )
    await session.flush()
    scan = Scan(
        id=uuid.uuid4(),
        user_id=user_id,
        tune_id=tune_id,
        width=10,
        height=10,
        created_at=created_at,
        updated_at=created_at,
        deleted_at=deleted_at,
    )
    session.add(scan)
    await session.flush()
    return tune_id, scan


async def test_scan_tune_id_is_the_oldest_live_scan(session) -> None:
    user_id = await _user(session)
    assert await scan_tune_id(session, user_id) is None

    tune_a, scan_a = await _tune_with_scan(session, user_id, NOW)
    tune_b, _ = await _tune_with_scan(session, user_id, NOW + timedelta(seconds=5))
    assert await scan_tune_id(session, user_id) == tune_a

    scan_a.deleted_at = NOW + timedelta(seconds=10)
    await session.flush()
    assert await scan_tune_id(session, user_id) == tune_b

    other = await _user(session)
    assert await scan_tune_id(session, other) is None


async def test_scan_tune_id_breaks_a_created_at_tie_by_id(session) -> None:
    user_id = await _user(session)
    _, first = await _tune_with_scan(session, user_id, NOW)
    _, second = await _tune_with_scan(session, user_id, NOW)
    lower = min((first, second), key=lambda scan: scan.id)

    assert await scan_tune_id(session, user_id) == lower.tune_id
