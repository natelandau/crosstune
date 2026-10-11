"""Billing states for test accounts."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import delete, select, text

from crosstune.billing.access import access_for, refresh_entitlement
from crosstune.billing.grants import grant_comp
from crosstune.db.locks import advisory_lock_key
from crosstune.models import Entitlement, Grant
from crosstune.models.user import utc_now
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.seed import GRANTED_BY
from crosstune.ops.testdata.state import PREMIUM_REASON, AccountState, apply_state
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import GrantKind, GrantSource

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from crosstune.models import User

pytestmark = pytest.mark.anyio


async def _user(session: AsyncSession, settings: Settings, name: str) -> User:
    return await get_or_create_user(session, f"user_state_{name}", f"{name}@example.com", settings)


async def _entitlement(session: AsyncSession, user: User) -> Entitlement:
    return (
        await session.execute(
            select(Entitlement)
            .where(Entitlement.user_id == user.id)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def _trial(session: AsyncSession, user: User) -> Grant | None:
    return await session.scalar(
        select(Grant)
        .where(Grant.user_id == user.id, Grant.source == GrantSource.TRIAL.value)
        .execution_options(populate_existing=True)
    )


async def _grant(
    session: AsyncSession, user: User, kind: GrantKind, source: GrantSource
) -> Grant | None:
    return await session.scalar(
        select(Grant)
        .where(Grant.user_id == user.id, Grant.kind == kind.value, Grant.source == source.value)
        .execution_options(populate_existing=True)
    )


async def _drop_trial(session: AsyncSession, user: User) -> None:
    await session.execute(
        delete(Grant).where(Grant.user_id == user.id, Grant.source == GrantSource.TRIAL.value)
    )


def _store_grant(user: User, source: GrantSource, expires_at: datetime) -> Grant:
    return Grant(
        user_id=user.id,
        kind=GrantKind.PREMIUM.value,
        source=source.value,
        expires_at=expires_at,
    )


async def test_trial_restarts_after_comp(session: AsyncSession, settings: Settings) -> None:
    now = utc_now()
    user = await _user(session, settings, "trial")
    await grant_comp(
        session, user.id, expires_at=None, storage_addon=False, granted_by="t", reason="t", now=now
    )
    await refresh_entitlement(session, user.id, settings, now)

    await apply_state(session, user.id, AccountState.TRIAL, settings, now)

    row = await _entitlement(session, user)
    assert row.premium_source == "trial"
    assert row.trial_ends_at is not None
    assert abs(row.trial_ends_at - (now + timedelta(days=settings.trial_days))) < timedelta(
        seconds=1
    )


async def test_premium_is_open_ended_comp(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings, "premium")

    await apply_state(session, user.id, AccountState.PREMIUM, settings, utc_now())

    row = await _entitlement(session, user)
    assert row.premium_source == "comp"
    assert row.premium_expires_at is None
    comp = await _grant(session, user, GrantKind.PREMIUM, GrantSource.COMP)
    assert comp is not None
    assert (comp.granted_by, comp.reason) == (GRANTED_BY, PREMIUM_REASON)


async def test_lapsed_has_no_premium(session: AsyncSession, settings: Settings) -> None:
    now = utc_now()
    user = await _user(session, settings, "lapsed")
    await apply_state(session, user.id, AccountState.PREMIUM, settings, now)

    await apply_state(session, user.id, AccountState.LAPSED, settings, now)

    assert not (await access_for(session, user.id, settings, now)).premium
    trial = await _trial(session, user)
    assert trial is not None
    assert trial.expires_at == now


@pytest.mark.parametrize("state", list(AccountState))
async def test_state_resets_notice_marks(
    session: AsyncSession, settings: Settings, state: AccountState
) -> None:
    seen = utc_now()
    user = await _user(session, settings, f"marks_{state.value}")
    row = await _entitlement(session, user)
    row.recording_notice_seen_at = row.trial_reminder_seen_at = row.trial_end_seen_at = seen
    await session.flush()
    seq = row.server_seq
    now = seen + timedelta(minutes=5)

    await apply_state(session, user.id, state, settings, now)

    row = await _entitlement(session, user)
    assert row.recording_notice_seen_at is None
    assert row.trial_reminder_seen_at is None
    assert row.trial_end_seen_at is None
    assert row.server_seq > seq
    assert row.updated_at == now


async def test_store_subscription_refused(session: AsyncSession, settings: Settings) -> None:
    now = utc_now()
    user = await _user(session, settings, "store")
    session.add(
        Grant(
            user_id=user.id,
            kind=GrantKind.PREMIUM.value,
            source=GrantSource.APPLE.value,
            expires_at=now + timedelta(days=30),
        )
    )
    await refresh_entitlement(session, user.id, settings, now)
    before = await _entitlement(session, user)
    snapshot = (before.premium_source, before.server_seq)

    with pytest.raises(DataCommandError, match="apple"):
        await apply_state(session, user.id, AccountState.LAPSED, settings, now)

    after = await _entitlement(session, user)
    assert (after.premium_source, after.server_seq) == snapshot


async def _holds_user_lock(session: AsyncSession, user: User) -> bool:
    key = advisory_lock_key(user.id) & 0xFFFFFFFFFFFFFFFF
    held = await session.scalar(
        text(
            "select count(*) from pg_locks where locktype = 'advisory'"
            " and pid = pg_backend_pid() and mode = 'ExclusiveLock' and objsubid = 1"
            " and classid::bigint = :high and objid::bigint = :low"
        ),
        {"high": key >> 32, "low": key & 0xFFFFFFFF},
    )
    return held == 1


async def test_state_takes_the_user_lock(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings, "lock")
    await session.commit()
    assert not await _holds_user_lock(session, user)

    await apply_state(session, user.id, AccountState.PREMIUM, settings, utc_now())

    assert await _holds_user_lock(session, user)


async def test_trial_without_a_trial_grant_starts_one(
    session: AsyncSession, settings: Settings
) -> None:
    now = utc_now()
    user = await _user(session, settings, "no_trial")
    await _drop_trial(session, user)

    await apply_state(session, user.id, AccountState.TRIAL, settings, now)

    trial = await _trial(session, user)
    assert trial is not None
    assert trial.expires_at == now + timedelta(days=settings.trial_days)
    assert (await _entitlement(session, user)).premium_source == "trial"


async def test_lapsed_without_a_trial_grant_has_no_premium(
    session: AsyncSession, settings: Settings
) -> None:
    now = utc_now()
    user = await _user(session, settings, "lapsed_no_trial")
    await _drop_trial(session, user)

    await apply_state(session, user.id, AccountState.LAPSED, settings, now)

    assert await _trial(session, user) is None
    assert not (await access_for(session, user.id, settings, now)).premium


async def test_premium_leaves_no_active_storage_addon(
    session: AsyncSession, settings: Settings
) -> None:
    now = utc_now()
    user = await _user(session, settings, "addon")
    await grant_comp(
        session, user.id, expires_at=None, storage_addon=True, granted_by="t", reason="t", now=now
    )

    await apply_state(session, user.id, AccountState.PREMIUM, settings, now)

    addon = await _grant(session, user, GrantKind.STORAGE_ADDON, GrantSource.COMP)
    assert addon is not None
    assert addon.expires_at is not None
    assert addon.expires_at <= now


async def test_stripe_subscription_refused(session: AsyncSession, settings: Settings) -> None:
    now = utc_now()
    user = await _user(session, settings, "stripe")
    session.add(_store_grant(user, GrantSource.STRIPE, now + timedelta(days=30)))
    await session.flush()

    with pytest.raises(DataCommandError, match="stripe"):
        await apply_state(session, user.id, AccountState.PREMIUM, settings, now)


async def test_expired_store_grant_does_not_block(
    session: AsyncSession, settings: Settings
) -> None:
    now = utc_now()
    user = await _user(session, settings, "expired_store")
    session.add(_store_grant(user, GrantSource.APPLE, now - timedelta(days=1)))
    await session.flush()

    await apply_state(session, user.id, AccountState.PREMIUM, settings, now)

    assert (await _entitlement(session, user)).premium_source == "comp"
