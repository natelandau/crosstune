"""The runner's purges, slot releases, and orphan sweeps over scan images."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select, update

from crosstune.db.base import new_uuid7, utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.files.quota import slot_for_scan
from crosstune.jobs import sweep as sweep_module
from crosstune.jobs.runner import JobRunner
from crosstune.jobs.sweep import ABANDONED_SLOT_GRACE
from crosstune.models import Scan, Tune, UploadSlot, User
from crosstune.storage.store import SCAN_MIME, SCAN_SEGMENT, legacy_scan_key, scan_key
from tests.fakes import FakeObjectStore
from tests.helpers import T1, change, push
from tests.test_scans_api import make_scan, put_object

if TYPE_CHECKING:
    from crosstune.config import Settings

pytestmark = pytest.mark.anyio


@pytest.fixture
def runner(engine, tmp_path, settings: Settings) -> tuple[JobRunner, FakeObjectStore]:
    store = FakeObjectStore()
    return JobRunner(make_sessionmaker(engine), store, work_root=tmp_path, settings=settings), store


async def make_user(session) -> User:
    user = User(id=new_uuid7(), clerk_user_id=f"user_{uuid.uuid4().hex[:8]}")
    session.add(user)
    await session.flush()
    return user


async def add_scan(session, user: User, **fields) -> Scan:
    now = utc_now()
    tune = Tune(id=new_uuid7(), owner_user_id=user.id, title="X", created_at=now, updated_at=now)
    session.add(tune)
    await session.flush()
    scan = Scan(
        id=new_uuid7(),
        user_id=user.id,
        tune_id=tune.id,
        width=1200,
        height=1600,
        created_at=now,
        updated_at=now,
        **fields,
    )
    session.add(scan)
    await session.flush()
    return scan


PAST_GRACE = ABANDONED_SLOT_GRACE + timedelta(minutes=1)


async def add_slot(session, scan: Scan, *, expired_for: timedelta) -> None:
    session.add(
        UploadSlot(
            scan_id=scan.id,
            user_id=scan.user_id,
            declared_bytes=3,
            content_type=SCAN_MIME,
            expires_at=utc_now() - expired_for,
        )
    )
    await session.commit()


async def ready_scan(session, store: FakeObjectStore, user: User, **fields) -> Scan:
    scan = await add_scan(session, user, state="ready", file_bytes=3, **fields)
    scan.file_key = scan_key(user.id, scan.id)
    await session.commit()
    store.put_bytes(scan.file_key, b"abc", SCAN_MIME)
    return scan


async def test_sweep_keeps_object_of_live_scan(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await ready_scan(verify_session, store, user)
    assert await job_runner.sweep_orphans() == 0
    assert store.keys() == [scan.file_key]


async def test_sweep_removes_scan_prefix_with_no_row(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    kept = await ready_scan(verify_session, store, user)
    stray = new_uuid7()
    store.put_bytes(scan_key(user.id, stray), b"abc", SCAN_MIME)
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == [kept.file_key]
    assert await job_runner.sweep_orphans() == 0


async def test_sweep_leaves_non_uuid_scan_keys(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    await verify_session.commit()
    readme = f"{user.id}/{SCAN_SEGMENT}/readme"
    nested = f"{user.id}/{SCAN_SEGMENT}/not-a-uuid/scan.jpg"
    store.put_bytes(readme, b"a", "text/plain")
    store.put_bytes(nested, b"a", SCAN_MIME)
    assert await job_runner.sweep_orphans() == 0
    assert store.keys() == sorted([readme, nested])


async def test_purge_removes_object_of_deleted_scan(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await ready_scan(verify_session, store, user, deleted_at=utc_now())
    before_seq = scan.server_seq
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    await verify_session.refresh(scan)
    assert (scan.file_key, scan.file_bytes, scan.state) == (
        None,
        None,
        "pending_upload",
    )
    assert scan.server_seq > before_seq
    assert await job_runner.run_once() == 0


async def test_purge_removes_an_upload_deleted_before_it_was_confirmed(
    runner, verify_session
) -> None:
    """A PUT can land after the scan is deleted; only the abandoned slot says the object may exist."""
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user, deleted_at=utc_now())
    await add_slot(verify_session, scan, expired_for=PAST_GRACE)
    store.put_bytes(scan_key(user.id, scan.id), b"abc", SCAN_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_scan(verify_session, scan.id) is None
    assert await job_runner.run_once() == 0


async def test_purge_collects_an_image_that_lands_after_the_purge(runner, verify_session) -> None:
    """A PUT signed before the delete can land after the purge; the kept slot brings it back."""
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await ready_scan(verify_session, store, user, deleted_at=utc_now())
    await add_slot(verify_session, scan, expired_for=-timedelta(minutes=5))
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_scan(verify_session, scan.id) is not None
    assert await job_runner.run_once() == 0
    key = scan_key(user.id, scan.id)
    store.put_bytes(key, b"abc", SCAN_MIME)
    slot = await slot_for_scan(verify_session, scan.id)
    slot.expires_at = utc_now() - PAST_GRACE
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_scan(verify_session, scan.id) is None
    assert await job_runner.run_once() == 0


async def test_purge_leaves_a_scan_undeleted_and_confirmed_meanwhile(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rows are re-read under the locks, so a scan live again keeps its new image."""
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await ready_scan(verify_session, store, user, deleted_at=utc_now())
    lock_users = sweep_module._lock_users

    async def undelete_then_lock(session, rows) -> None:
        scan.deleted_at = None
        await verify_session.commit()
        await lock_users(session, rows)

    monkeypatch.setattr(sweep_module, "_lock_users", undelete_then_lock)
    seq_before = scan.server_seq
    assert await job_runner.run_once() == 0
    assert store.keys() == [scan.file_key]
    await verify_session.refresh(scan)
    assert (scan.state, scan.file_bytes) == ("ready", 3)
    assert scan.server_seq == seq_before


async def test_purge_removes_object_of_scan_tombstoned_by_tune_delete(
    client, auth_headers, object_store, engine, tmp_path, verify_session, settings: Settings
) -> None:
    tune, scan_id = await make_scan(client, auth_headers)
    key = await put_object(object_store, verify_session, scan_id, 3)
    await verify_session.execute(
        update(Scan).where(Scan.id == scan_id).values(state="ready", file_key=key, file_bytes=3)
    )
    await verify_session.commit()
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, op="delete"))
    job_runner = JobRunner(
        make_sessionmaker(engine), object_store, work_root=tmp_path, settings=settings
    )
    assert await job_runner.run_once() == 1
    assert object_store.keys() == []
    verify_session.expire_all()
    stored = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    assert stored.deleted_at is not None
    assert (stored.file_key, stored.file_bytes, stored.state) == (None, None, "pending_upload")


async def test_release_abandoned_scan_slot_deletes_object(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user)
    await add_slot(verify_session, scan, expired_for=PAST_GRACE)
    store.put_bytes(scan_key(user.id, scan.id), b"abc", SCAN_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_scan(verify_session, scan.id) is None
    await verify_session.refresh(scan)
    assert (scan.state, scan.file_bytes, scan.deleted_at) == (
        "pending_upload",
        None,
        None,
    )
    assert await job_runner.run_once() == 0


async def test_release_keeps_a_scan_confirmed_under_a_reissued_slot(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The upload key is the served key, so a confirmation before the re-check keeps its image."""
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user)
    await add_slot(verify_session, scan, expired_for=PAST_GRACE)
    key = scan_key(user.id, scan.id)
    store.put_bytes(key, b"abc", SCAN_MIME)
    lock_users = sweep_module._lock_users

    async def confirm_then_lock(session, rows) -> None:
        slot = await slot_for_scan(verify_session, scan.id)
        assert slot is not None
        await verify_session.delete(slot)
        scan.state = "ready"
        scan.file_key = key
        scan.file_bytes = 3
        await verify_session.commit()
        await lock_users(session, rows)

    monkeypatch.setattr(sweep_module, "_lock_users", confirm_then_lock)
    assert await job_runner.run_once() == 0
    assert store.keys() == [key]
    await verify_session.refresh(scan)
    assert (scan.state, scan.file_key) == ("ready", key)


async def test_release_keeps_a_scan_slot_inside_the_grace(runner, verify_session) -> None:
    """A PUT signed just before expiry may still be on its way."""
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user)
    await add_slot(verify_session, scan, expired_for=timedelta(minutes=5))
    key = scan_key(user.id, scan.id)
    store.put_bytes(key, b"abc", SCAN_MIME)
    assert await job_runner.run_once() == 0
    assert store.keys() == [key]
    assert await slot_for_scan(verify_session, scan.id) is not None


async def test_next_due_is_an_abandoned_scan_slot_past_grace(runner, verify_session) -> None:
    job_runner, _ = runner
    await job_runner.run_once()
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user)
    await add_slot(verify_session, scan, expired_for=timedelta(seconds=10))
    slot = await slot_for_scan(verify_session, scan.id)
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_next_due_is_a_deleted_scans_slot_past_grace(runner, verify_session) -> None:
    """A purge keeps a deleted scan's slot until no PUT can land, then must run again."""
    job_runner, _ = runner
    await job_runner.run_once()
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user, deleted_at=utc_now())
    await add_slot(verify_session, scan, expired_for=timedelta(seconds=10))
    slot = await slot_for_scan(verify_session, scan.id)
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_account_purge_removes_scans(
    client, app, auth_headers, object_store, verify_session
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    key = await put_object(object_store, verify_session, scan_id, 3)
    assert object_store.keys() == [key]
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert object_store.keys() == []
    assert await verify_session.scalar(select(func.count()).select_from(Scan)) == 0


def test_new_uploads_use_the_scans_segment() -> None:
    user_id, scan_id = new_uuid7(), new_uuid7()
    assert scan_key(user_id, scan_id) == f"{user_id}/scans/{scan_id}/scan.jpg"


async def legacy_ready_scan(session, store: FakeObjectStore, user: User, **fields) -> Scan:
    scan = await add_scan(session, user, state="ready", file_bytes=3, **fields)
    scan.file_key = legacy_scan_key(user.id, scan.id)
    await session.commit()
    store.put_bytes(scan.file_key, b"abc", SCAN_MIME)
    return scan


async def test_sweep_keeps_legacy_object_and_removes_legacy_prefix_with_no_row(
    runner, verify_session
) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    kept = await legacy_ready_scan(verify_session, store, user)
    store.put_bytes(legacy_scan_key(user.id, new_uuid7()), b"abc", SCAN_MIME)
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == [kept.file_key]


async def test_purge_removes_legacy_object_of_deleted_scan(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await legacy_ready_scan(verify_session, store, user, deleted_at=utc_now())
    store.put_bytes(scan_key(user.id, scan.id), b"abc", SCAN_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []


async def test_release_abandoned_scan_slot_deletes_legacy_object(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    scan = await add_scan(verify_session, user)
    await add_slot(verify_session, scan, expired_for=PAST_GRACE)
    store.put_bytes(legacy_scan_key(user.id, scan.id), b"abc", SCAN_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []
