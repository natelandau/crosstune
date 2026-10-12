"""Seeding an account from a test data plan."""

from __future__ import annotations

import uuid
from collections import Counter
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select

from crosstune.billing.access import access_for, refresh_entitlement
from crosstune.billing.grants import grant_comp, set_trial_end
from crosstune.db.base import utc_now
from crosstune.models import Entitlement, Grant, Job, Recording, Scan
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.fixture import (
    DEFAULT_FIXTURES_DIR,
    Counts,
    Plan,
    build_plan,
    load_fixture,
)
from crosstune.ops.testdata.seed import (
    _attach_recording,
    grant_seed_comp,
    restore_server_grants,
    seed_plan,
    snapshot_server_grants,
)
from crosstune.storage.store import scan_key, upload_key
from crosstune.sync.tables import TABLE_ORDER, TABLES
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import (
    GrantKind,
    GrantSource,
    JobKind,
    RecordingSource,
    RecordingState,
)
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from crosstune.models import User

pytestmark = pytest.mark.anyio

STANDARD = DEFAULT_FIXTURES_DIR / "standard"


async def _user(session: AsyncSession, settings: Settings) -> User:
    return await get_or_create_user(session, "user_seed_test", "s+clerk_test@example.com", settings)


def _plan() -> Plan:
    return build_plan(load_fixture(STANDARD), Counts(), now=utc_now())


async def _seed(
    session: AsyncSession, settings: Settings, store: FakeObjectStore
) -> tuple[User, Plan, list[uuid.UUID]]:
    user = await _user(session, settings)
    plan = _plan()
    now = utc_now()
    snapshot = await snapshot_server_grants(session, user.id)
    await grant_seed_comp(session, user.id, settings, now)
    enqueued = await seed_plan(session, store, user, plan, settings)
    await restore_server_grants(session, user.id, snapshot, settings, utc_now())
    return user, plan, enqueued


async def _job_count(session: AsyncSession, user_id: uuid.UUID, kind: JobKind) -> int:
    return await session.scalar(
        select(func.count())
        .select_from(Job)
        .join(Recording, Recording.id == Job.recording_id)
        .where(Recording.user_id == user_id, Job.kind == kind.value)
    )


async def _premium_grant(
    session: AsyncSession,
    user_id: uuid.UUID,
    source: GrantSource,
    kind: GrantKind = GrantKind.PREMIUM,
) -> Grant | None:
    return await session.scalar(
        select(Grant)
        .where(
            Grant.user_id == user_id,
            Grant.kind == kind.value,
            Grant.source == source.value,
        )
        .execution_options(populate_existing=True)
    )


async def test_seed_writes_every_planned_row(session: AsyncSession, settings: Settings) -> None:
    user, plan, _ = await _seed(session, settings, FakeObjectStore())

    planned = Counter(change.table for change in plan.changes)
    for table in TABLE_ORDER:
        if table not in planned:
            continue
        spec = TABLES[table]
        count = await session.scalar(
            select(func.count()).select_from(spec.model).where(spec.owned_by(user.id))
        )
        assert count == planned[table], table


async def test_seed_uploads_one_object_per_file(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    user, plan, _ = await _seed(session, settings, store)

    assert len(plan.recordings) == 10
    assert len(plan.scans) == 5
    for planned in plan.recordings:
        assert store.get_bytes(upload_key(user.id, planned.id)) == planned.path.read_bytes()
    for planned in plan.scans:
        key = scan_key(user.id, planned.id)
        assert store.get_bytes(key) == planned.path.read_bytes()
        scan = await session.get(Scan, planned.id)
        assert (scan.state, scan.file_key) == ("ready", key)


async def test_seed_queues_transcode_not_import(session: AsyncSession, settings: Settings) -> None:
    user, plan, enqueued = await _seed(session, settings, FakeObjectStore())

    assert await _job_count(session, user.id, JobKind.TRANSCODE) == 10
    assert await _job_count(session, user.id, JobKind.IMPORT) == 0
    assert sorted(enqueued) == sorted(p.id for p in plan.recordings)
    imports = [p for p in plan.recordings if p.source == RecordingSource.IMPORT]
    assert imports
    for planned in imports:
        recording = await session.get(Recording, planned.id)
        assert recording.state == RecordingState.UPLOADED


async def test_seed_on_lapsed_account_under_temporary_comp(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    now = utc_now()
    await set_trial_end(session, user.id, now)
    await refresh_entitlement(session, user.id, settings, now)
    trial_end = (await _premium_grant(session, user.id, GrantSource.TRIAL)).expires_at

    snapshot = await snapshot_server_grants(session, user.id)
    await grant_seed_comp(session, user.id, settings, utc_now())
    await seed_plan(session, FakeObjectStore(), user, _plan(), settings)
    await restore_server_grants(session, user.id, snapshot, settings, utc_now())

    assert not (await access_for(session, user.id, settings)).premium
    assert (await _premium_grant(session, user.id, GrantSource.TRIAL)).expires_at == trial_end


async def test_restore_removes_seed_comp(session: AsyncSession, settings: Settings) -> None:
    user, _, _ = await _seed(session, settings, FakeObjectStore())

    comp = await _premium_grant(session, user.id, GrantSource.COMP)
    assert comp is None
    entitlement = await session.scalar(
        select(Entitlement)
        .where(Entitlement.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    assert entitlement.premium_source == "trial"


async def test_restore_keeps_existing_comp(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    now = utc_now()
    expires_at = now + timedelta(days=30)
    await grant_comp(
        session,
        user.id,
        expires_at=expires_at,
        storage_addon=False,
        granted_by="ops",
        reason="friend of the band",
        now=now,
    )
    await refresh_entitlement(session, user.id, settings, now)

    snapshot = await snapshot_server_grants(session, user.id)
    await grant_seed_comp(session, user.id, settings, utc_now())
    await seed_plan(session, FakeObjectStore(), user, _plan(), settings)
    await restore_server_grants(session, user.id, snapshot, settings, utc_now())

    comp = await _premium_grant(session, user.id, GrantSource.COMP)
    assert (comp.granted_by, comp.reason, comp.expires_at) == (
        "ops",
        "friend of the band",
        expires_at,
    )


async def test_seed_refused_rows_raise(session: AsyncSession, settings: Settings) -> None:
    user = await _user(session, settings)
    await grant_seed_comp(session, user.id, settings, utc_now())
    scan = next(change for change in _plan().changes if change.table == "scans")
    orphan = scan.model_copy(update={"data": {**scan.data, "tune_id": str(uuid.uuid4())}})

    with pytest.raises(DataCommandError, match=str(scan.id)):
        await seed_plan(
            session,
            FakeObjectStore(),
            user,
            Plan(changes=[orphan], recordings=[], scans=[]),
            settings,
        )


async def _seed_and_restore(session: AsyncSession, settings: Settings, user: User) -> None:
    snapshot = await snapshot_server_grants(session, user.id)
    await grant_seed_comp(session, user.id, settings, utc_now())
    await seed_plan(session, FakeObjectStore(), user, _plan(), settings)
    await restore_server_grants(session, user.id, snapshot, settings, utc_now())


async def test_restore_keeps_existing_comp_with_storage_addon(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    now = utc_now()
    expires_at = now + timedelta(days=30)
    await grant_comp(
        session,
        user.id,
        expires_at=expires_at,
        storage_addon=True,
        granted_by="ops",
        reason="friend of the band",
        now=now,
    )
    await refresh_entitlement(session, user.id, settings, now)

    await _seed_and_restore(session, settings, user)

    addon = await _premium_grant(session, user.id, GrantSource.COMP, GrantKind.STORAGE_ADDON)
    assert addon is not None
    assert (addon.granted_by, addon.reason, addon.expires_at) == (
        "ops",
        "friend of the band",
        expires_at,
    )


async def test_restore_gives_a_running_trial_its_end_back(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    trial = await _premium_grant(session, user.id, GrantSource.TRIAL)
    assert trial is not None
    trial_end = trial.expires_at

    await _seed_and_restore(session, settings, user)

    trial = await _premium_grant(session, user.id, GrantSource.TRIAL)
    assert trial is not None
    assert trial.expires_at == trial_end
    assert trial_end > utc_now()


async def test_restore_keeps_the_original_updated_at(
    session: AsyncSession, settings: Settings
) -> None:
    user = await _user(session, settings)
    trial = await _premium_grant(session, user.id, GrantSource.TRIAL)
    assert trial is not None
    updated_at = trial.updated_at

    await _seed_and_restore(session, settings, user)

    trial = await _premium_grant(session, user.id, GrantSource.TRIAL)
    assert trial is not None
    assert trial.updated_at == updated_at


@pytest.mark.parametrize(
    ("source", "attached"), [(RecordingSource.IMPORT, True), (RecordingSource.MICROPHONE, False)]
)
async def test_only_an_import_attaches_while_processing(
    session: AsyncSession,
    settings: Settings,
    source: RecordingSource,
    attached: bool,  # noqa: FBT001
) -> None:
    user = await _user(session, settings)
    await grant_seed_comp(session, user.id, settings, utc_now())
    plan = _plan()
    await seed_plan(session, FakeObjectStore(), user, plan, settings)
    planned = next(p for p in plan.recordings if p.source == source)
    recording = await session.get(Recording, planned.id)
    assert recording is not None
    recording.state = RecordingState.PROCESSING.value
    await session.flush()

    assert await _attach_recording(session, FakeObjectStore(), user.id, planned) is attached
