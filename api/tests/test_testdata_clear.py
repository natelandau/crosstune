"""Clearing an account back to a fresh start."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select

from crosstune.models import DeletedAccount, Entitlement, User
from crosstune.models.user import utc_now
from crosstune.ops.testdata.clear import clear_account
from crosstune.ops.testdata.fixture import (
    DEFAULT_FIXTURES_DIR,
    Counts,
    build_plan,
    load_fixture,
)
from crosstune.ops.testdata.seed import grant_seed_comp, seed_plan
from crosstune.storage.store import user_prefix
from crosstune.sync.tables import TABLES
from crosstune.users.service import get_or_create_user
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

CLERK_ID = "user_clear_test"
EMAIL = "c+clerk_test@example.com"


async def _seeded(session: AsyncSession, settings: Settings, store: FakeObjectStore) -> User:
    user = await get_or_create_user(session, CLERK_ID, EMAIL, settings)
    plan = build_plan(load_fixture(DEFAULT_FIXTURES_DIR / "standard"), Counts(), now=utc_now())
    await grant_seed_comp(session, user.id, settings, utc_now())
    await seed_plan(session, store, user, plan, settings)
    return user


async def test_clear_removes_rows_and_files(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    old = await _seeded(session, settings, store)
    old_id = old.id
    assert await store.list_keys(user_prefix(old_id))

    cleared = await clear_account(session, CLERK_ID, EMAIL, settings)

    assert cleared.old_user_id == old_id
    assert cleared.user.id != old_id
    # The caller deletes the files once the clear commits.
    assert await store.list_keys(user_prefix(old_id))
    for name, spec in TABLES.items():
        count = await session.scalar(
            select(func.count()).select_from(spec.model).where(spec.owned_by(cleared.user.id))
        )
        assert count == (1 if name == "entitlements" else 0), name


async def test_clear_does_not_denylist(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    await _seeded(session, settings, store)

    await clear_account(session, CLERK_ID, EMAIL, settings)

    assert await session.scalar(select(func.count()).select_from(DeletedAccount)) == 0
    assert (await get_or_create_user(session, CLERK_ID, EMAIL, settings)).clerk_user_id == CLERK_ID


async def test_clear_starts_fresh_trial(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    old = await _seeded(session, settings, store)
    old_id = old.id

    new = (await clear_account(session, CLERK_ID, EMAIL, settings)).user

    ent = await session.scalar(
        select(Entitlement)
        .where(Entitlement.user_id == new.id)
        .execution_options(populate_existing=True)
    )
    assert new.id != old_id
    assert ent.premium_source == "trial"
    assert ent.recording_notice_seen_at is None
    assert ent.trial_reminder_seen_at is None
    assert ent.trial_end_seen_at is None


async def test_clear_without_existing_row_creates_user(
    session: AsyncSession, settings: Settings
) -> None:
    cleared = await clear_account(session, CLERK_ID, EMAIL, settings)

    assert cleared.old_user_id is None
    assert cleared.user.clerk_user_id == CLERK_ID
    assert await session.get(User, cleared.user.id) is not None
