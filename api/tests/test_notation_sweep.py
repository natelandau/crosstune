"""The runner's purges, slot releases, and orphan sweeps over notation page images."""

from __future__ import annotations

import uuid
from datetime import timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select, update

from crosstune.db.engine import make_sessionmaker
from crosstune.files.quota import slot_for_page
from crosstune.jobs import sweep as sweep_module
from crosstune.jobs.runner import ABANDONED_SLOT_GRACE, JobRunner
from crosstune.models import NotationPage, Tune, UploadSlot, User
from crosstune.models.user import new_uuid7, utc_now
from crosstune.storage.store import NOTATION_MIME, NOTATION_SEGMENT, notation_key
from tests.fakes import FakeObjectStore
from tests.helpers import T1, change, push
from tests.test_notation_api import make_page, put_object

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


async def add_page(session, user: User, **fields) -> NotationPage:
    now = utc_now()
    tune = Tune(id=new_uuid7(), owner_user_id=user.id, title="X", created_at=now, updated_at=now)
    session.add(tune)
    await session.flush()
    notation_page = NotationPage(
        id=new_uuid7(),
        user_id=user.id,
        tune_id=tune.id,
        width=1200,
        height=1600,
        created_at=now,
        updated_at=now,
        **fields,
    )
    session.add(notation_page)
    await session.flush()
    return notation_page


PAST_GRACE = ABANDONED_SLOT_GRACE + timedelta(minutes=1)


async def add_slot(session, notation_page: NotationPage, *, expired_for: timedelta) -> None:
    session.add(
        UploadSlot(
            notation_page_id=notation_page.id,
            user_id=notation_page.user_id,
            declared_bytes=3,
            content_type=NOTATION_MIME,
            expires_at=utc_now() - expired_for,
        )
    )
    await session.commit()


async def ready_page(session, store: FakeObjectStore, user: User, **fields) -> NotationPage:
    notation_page = await add_page(session, user, state="ready", file_bytes=3, **fields)
    notation_page.file_key = notation_key(user.id, notation_page.id)
    await session.commit()
    store.put_bytes(notation_page.file_key, b"abc", NOTATION_MIME)
    return notation_page


async def test_sweep_keeps_object_of_live_page(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await ready_page(verify_session, store, user)
    assert await job_runner.sweep_orphans() == 0
    assert store.keys() == [notation_page.file_key]


async def test_sweep_removes_page_prefix_with_no_row(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    kept = await ready_page(verify_session, store, user)
    stray = new_uuid7()
    store.put_bytes(notation_key(user.id, stray), b"abc", NOTATION_MIME)
    assert await job_runner.sweep_orphans() == 1
    assert store.keys() == [kept.file_key]
    assert await job_runner.sweep_orphans() == 0


async def test_sweep_leaves_non_uuid_notation_keys(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    await verify_session.commit()
    readme = f"{user.id}/{NOTATION_SEGMENT}/readme"
    nested = f"{user.id}/{NOTATION_SEGMENT}/not-a-uuid/page.jpg"
    store.put_bytes(readme, b"a", "text/plain")
    store.put_bytes(nested, b"a", NOTATION_MIME)
    assert await job_runner.sweep_orphans() == 0
    assert store.keys() == sorted([readme, nested])


async def test_purge_removes_object_of_deleted_page(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await ready_page(verify_session, store, user, deleted_at=utc_now())
    before_seq = notation_page.server_seq
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    await verify_session.refresh(notation_page)
    assert (notation_page.file_key, notation_page.file_bytes, notation_page.state) == (
        None,
        None,
        "pending_upload",
    )
    assert notation_page.server_seq > before_seq
    assert await job_runner.run_once() == 0


async def test_purge_removes_an_upload_deleted_before_it_was_confirmed(
    runner, verify_session
) -> None:
    """A PUT can land after the page is deleted; only the abandoned slot says the object may exist."""
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user, deleted_at=utc_now())
    await add_slot(verify_session, notation_page, expired_for=PAST_GRACE)
    store.put_bytes(notation_key(user.id, notation_page.id), b"abc", NOTATION_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_page(verify_session, notation_page.id) is None
    assert await job_runner.run_once() == 0


async def test_purge_collects_an_image_that_lands_after_the_purge(runner, verify_session) -> None:
    """A PUT signed before the delete can land after the purge; the kept slot brings it back."""
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await ready_page(verify_session, store, user, deleted_at=utc_now())
    await add_slot(verify_session, notation_page, expired_for=-timedelta(minutes=5))
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_page(verify_session, notation_page.id) is not None
    assert await job_runner.run_once() == 0
    key = notation_key(user.id, notation_page.id)
    store.put_bytes(key, b"abc", NOTATION_MIME)
    slot = await slot_for_page(verify_session, notation_page.id)
    slot.expires_at = utc_now() - PAST_GRACE
    await verify_session.commit()
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_page(verify_session, notation_page.id) is None
    assert await job_runner.run_once() == 0


async def test_purge_leaves_a_page_undeleted_and_confirmed_meanwhile(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The rows are re-read under the locks, so a page live again keeps its new image."""
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await ready_page(verify_session, store, user, deleted_at=utc_now())
    lock_users = sweep_module._lock_users

    async def undelete_then_lock(session, rows) -> None:
        notation_page.deleted_at = None
        await verify_session.commit()
        await lock_users(session, rows)

    monkeypatch.setattr(sweep_module, "_lock_users", undelete_then_lock)
    seq_before = notation_page.server_seq
    assert await job_runner.run_once() == 0
    assert store.keys() == [notation_page.file_key]
    await verify_session.refresh(notation_page)
    assert (notation_page.state, notation_page.file_bytes) == ("ready", 3)
    assert notation_page.server_seq == seq_before


async def test_purge_removes_object_of_page_tombstoned_by_tune_delete(
    client, auth_headers, object_store, engine, tmp_path, verify_session, settings: Settings
) -> None:
    tune, page_id = await make_page(client, auth_headers)
    key = await put_object(object_store, verify_session, page_id, 3)
    await verify_session.execute(
        update(NotationPage)
        .where(NotationPage.id == page_id)
        .values(state="ready", file_key=key, file_bytes=3)
    )
    await verify_session.commit()
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, op="delete"))
    job_runner = JobRunner(
        make_sessionmaker(engine), object_store, work_root=tmp_path, settings=settings
    )
    assert await job_runner.run_once() == 1
    assert object_store.keys() == []
    verify_session.expire_all()
    stored = await verify_session.scalar(select(NotationPage).where(NotationPage.id == page_id))
    assert stored.deleted_at is not None
    assert (stored.file_key, stored.file_bytes, stored.state) == (None, None, "pending_upload")


async def test_release_abandoned_page_slot_deletes_object(runner, verify_session) -> None:
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user)
    await add_slot(verify_session, notation_page, expired_for=PAST_GRACE)
    store.put_bytes(notation_key(user.id, notation_page.id), b"abc", NOTATION_MIME)
    assert await job_runner.run_once() == 1
    assert store.keys() == []
    assert await slot_for_page(verify_session, notation_page.id) is None
    await verify_session.refresh(notation_page)
    assert (notation_page.state, notation_page.file_bytes, notation_page.deleted_at) == (
        "pending_upload",
        None,
        None,
    )
    assert await job_runner.run_once() == 0


async def test_release_keeps_a_page_confirmed_under_a_reissued_slot(
    runner, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The upload key is the served key, so a confirmation before the re-check keeps its image."""
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user)
    await add_slot(verify_session, notation_page, expired_for=PAST_GRACE)
    key = notation_key(user.id, notation_page.id)
    store.put_bytes(key, b"abc", NOTATION_MIME)
    lock_users = sweep_module._lock_users

    async def confirm_then_lock(session, rows) -> None:
        slot = await slot_for_page(verify_session, notation_page.id)
        assert slot is not None
        await verify_session.delete(slot)
        notation_page.state = "ready"
        notation_page.file_key = key
        notation_page.file_bytes = 3
        await verify_session.commit()
        await lock_users(session, rows)

    monkeypatch.setattr(sweep_module, "_lock_users", confirm_then_lock)
    assert await job_runner.run_once() == 0
    assert store.keys() == [key]
    await verify_session.refresh(notation_page)
    assert (notation_page.state, notation_page.file_key) == ("ready", key)


async def test_release_keeps_a_page_slot_inside_the_grace(runner, verify_session) -> None:
    """A PUT signed just before expiry may still be on its way."""
    job_runner, store = runner
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user)
    await add_slot(verify_session, notation_page, expired_for=timedelta(minutes=5))
    key = notation_key(user.id, notation_page.id)
    store.put_bytes(key, b"abc", NOTATION_MIME)
    assert await job_runner.run_once() == 0
    assert store.keys() == [key]
    assert await slot_for_page(verify_session, notation_page.id) is not None


async def test_next_due_is_an_abandoned_page_slot_past_grace(runner, verify_session) -> None:
    job_runner, _ = runner
    await job_runner.run_once()
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user)
    await add_slot(verify_session, notation_page, expired_for=timedelta(seconds=10))
    slot = await slot_for_page(verify_session, notation_page.id)
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_next_due_is_a_deleted_pages_slot_past_grace(runner, verify_session) -> None:
    """A purge keeps a deleted page's slot until no PUT can land, then must run again."""
    job_runner, _ = runner
    await job_runner.run_once()
    user = await make_user(verify_session)
    notation_page = await add_page(verify_session, user, deleted_at=utc_now())
    await add_slot(verify_session, notation_page, expired_for=timedelta(seconds=10))
    slot = await slot_for_page(verify_session, notation_page.id)
    assert await job_runner.next_due() == slot.expires_at + ABANDONED_SLOT_GRACE


async def test_account_purge_removes_pages(
    client, app, auth_headers, object_store, verify_session
) -> None:
    _, page_id = await make_page(client, auth_headers)
    key = await put_object(object_store, verify_session, page_id, 3)
    assert object_store.keys() == [key]
    response = await client.delete("/v1/me", headers=auth_headers("user_a"))
    assert response.status_code == 204
    assert object_store.keys() == []
    assert await verify_session.scalar(select(func.count()).select_from(NotationPage)) == 0
