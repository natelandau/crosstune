"""The daily pass that warns inactive accounts and then deletes their recordings and scans."""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import delete, select, update

from crosstune.db.base import new_uuid7
from crosstune.db.engine import make_sessionmaker
from crosstune.db.locks import lock_user as real_lock_user
from crosstune.email.resend import EmailMessage, MailerRateLimitedError, MailerUnavailableError
from crosstune.inactivity import sweep as sweep_module
from crosstune.inactivity.emails import idempotency_key
from crosstune.inactivity.rules import FIRST_NOTICE, INACTIVE_AFTER, Step
from crosstune.inactivity.sweep import run_inactivity
from crosstune.jobs.sweep import purge_deleted, purge_deleted_scans
from crosstune.models import (
    Grant,
    InactivityNotice,
    List,
    Recording,
    RecordingLoop,
    Scan,
    Tune,
    User,
)
from crosstune.storage.store import SCAN_MIME, new_rev, playback_key, scan_key
from crosstune.users.clerk import ClerkUnavailableError, ClerkUser
from crosstune.vocabulary import GrantKind, GrantSource
from tests.fakes import FakeClerkUsers, FakeMailer, FakeObjectStore

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

NOW = datetime(2027, 3, 1, 9, 0, tzinfo=UTC)
# Synced last exactly when the first warning falls due at NOW.
ACTIVE_SINCE = NOW - INACTIVE_AFTER + FIRST_NOTICE
SECOND_AT = NOW + timedelta(days=23)
DELETE_AT = NOW + timedelta(days=30)
EMAIL = "musician@example.com"


@dataclass
class Seeded:
    """An account and the rows the pass must delete or keep."""

    user: User
    tune: Tune
    lst: List
    recording: Recording
    loop: RecordingLoop
    scan: Scan


@pytest.fixture
def sessionmaker(engine) -> async_sessionmaker[AsyncSession]:
    return make_sessionmaker(engine)


@pytest.fixture
def mailer() -> FakeMailer:
    return FakeMailer()


@pytest.fixture
def clerk() -> FakeClerkUsers:
    return FakeClerkUsers()


@pytest.fixture
def store() -> FakeObjectStore:
    return FakeObjectStore()


async def seed_user(
    session: AsyncSession,
    clerk: FakeClerkUsers,
    store: FakeObjectStore,
    *,
    last_synced_at: datetime | None = ACTIVE_SINCE,
    files: bool = True,
    email: str | None = EMAIL,
) -> Seeded:
    """Commit an account with a tune, a list, and, unless `files` is False, live files."""
    clerk_id = f"user_{uuid.uuid4().hex[:12]}"
    clerk.users[clerk_id] = email
    at = ACTIVE_SINCE - timedelta(days=60)
    user = User(
        id=new_uuid7(), clerk_user_id=clerk_id, created_at=at, last_synced_at=last_synced_at
    )
    session.add(user)
    await session.flush()
    tune = Tune(
        id=new_uuid7(), owner_user_id=user.id, title="Sally Goodin", created_at=at, updated_at=at
    )
    lst = List(id=new_uuid7(), user_id=user.id, name="Jam", created_at=at, updated_at=at)
    session.add_all([tune, lst])
    await session.flush()
    rec_id = new_uuid7()
    recording = Recording(
        id=rec_id,
        user_id=user.id,
        tune_id=tune.id,
        source="microphone",
        added_at=at,
        recorded_at=at,
        recorded_precision="time",
        created_at=at,
        updated_at=at,
        deleted_at=None if files else at,
        state="ready",
        playback_key=playback_key(user.id, rec_id, new_rev()),
        playback_bytes=3,
    )
    session.add(recording)
    await session.flush()
    loop = RecordingLoop(
        id=new_uuid7(),
        user_id=user.id,
        recording_id=rec_id,
        start_ms=0,
        end_ms=1000,
        color=0,
        created_at=at,
        updated_at=at,
    )
    scan_id = new_uuid7()
    scan = Scan(
        id=scan_id,
        user_id=user.id,
        tune_id=tune.id,
        width=1200,
        height=1600,
        state="ready",
        file_key=scan_key(user.id, scan_id),
        file_bytes=3,
        created_at=at,
        updated_at=at,
        deleted_at=None if files else at,
    )
    session.add_all([loop, scan])
    await session.commit()
    store.put_bytes(recording.playback_key, b"abc", "audio/mp4")
    store.put_bytes(scan.file_key, b"abc", SCAN_MIME)
    return Seeded(user, tune, lst, recording, loop, scan)


def fixed(moment: datetime) -> Callable[[], datetime]:
    """A clock that always reads `moment`, as if every send took no time."""
    return lambda: moment


async def notice_of(session: AsyncSession, user: User) -> InactivityNotice | None:
    return await session.scalar(
        select(InactivityNotice)
        .where(InactivityNotice.user_id == user.id)
        .execution_options(populate_existing=True)
    )


async def refreshed(session: AsyncSession, *rows: object) -> None:
    for row in rows:
        await session.refresh(row)


async def assert_untouched(session: AsyncSession, seeded: Seeded) -> None:
    await refreshed(session, seeded.recording, seeded.loop, seeded.scan)
    assert seeded.recording.deleted_at is None
    assert seeded.loop.deleted_at is None
    assert seeded.scan.deleted_at is None


async def sync(session: AsyncSession, user: User, at: datetime) -> None:
    await session.execute(update(User).where(User.id == user.id).values(last_synced_at=at))
    await session.commit()


async def test_warns_then_deletes(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await verify_session.execute(
        update(Recording).where(Recording.id == seeded.recording.id).values(label="Take one")
    )
    await verify_session.execute(
        update(RecordingLoop).where(RecordingLoop.id == seeded.loop.id).values(label="B part")
    )
    await verify_session.commit()
    await refreshed(verify_session, seeded.recording, seeded.loop)
    seqs = (seeded.recording.server_seq, seeded.loop.server_seq, seeded.scan.server_seq)

    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 1
    notice = await notice_of(verify_session, seeded.user)
    assert notice is not None
    assert notice.active_since == ACTIVE_SINCE
    assert notice.first_sent_at == NOW
    assert notice.deletion_due_at == DELETE_AT
    assert notice.second_sent_at is None

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, SECOND_AT, clock=fixed(SECOND_AT)
        )
        == 1
    )
    notice = await notice_of(verify_session, seeded.user)
    assert notice.second_sent_at == SECOND_AT
    assert notice.deletion_due_at == DELETE_AT

    assert [(message.to, key) for message, key in mailer.sent] == [
        (EMAIL, idempotency_key(seeded.user.id, ACTIVE_SINCE, Step.FIRST)),
        (EMAIL, idempotency_key(seeded.user.id, ACTIVE_SINCE, Step.SECOND)),
    ]
    # Nothing is deleted a moment before the recorded date.
    assert (
        await run_inactivity(
            sessionmaker,
            mailer,
            clerk,
            settings,
            DELETE_AT - timedelta(seconds=1),
            clock=fixed(DELETE_AT - timedelta(seconds=1)),
        )
        == 0
    )
    await assert_untouched(verify_session, seeded)

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 1
    )
    await refreshed(
        verify_session, seeded.recording, seeded.loop, seeded.scan, seeded.tune, seeded.lst
    )
    for row, before in zip((seeded.recording, seeded.loop, seeded.scan), seqs, strict=True):
        assert row.deleted_at == DELETE_AT
        assert row.updated_at == DELETE_AT
        assert row.server_seq > before
    assert seeded.recording.label is None
    assert seeded.loop.label is None
    assert seeded.tune.deleted_at is None
    assert seeded.lst.deleted_at is None
    assert await notice_of(verify_session, seeded.user) is None
    assert len(mailer.sent) == 2

    assert await purge_deleted(sessionmaker, store) == 1
    assert await purge_deleted_scans(sessionmaker, store) == 1
    assert store.keys() == []
    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 0
    )


@pytest.mark.parametrize("failure", ["no-email", "no-clerk-user", "clerk-down", "mailer-refuses"])
async def test_never_deletes_unwarned(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, failure: str
) -> None:
    seeded = await seed_user(
        verify_session, clerk, store, email=None if failure == "no-email" else EMAIL
    )
    if failure == "no-clerk-user":
        clerk.users.clear()
    elif failure == "clerk-down":
        clerk.error = ClerkUnavailableError("down")
    elif failure == "mailer-refuses":
        mailer.error = MailerUnavailableError("refused")

    for days in (0, 23, 30, 31, 400, 4000):
        await run_inactivity(
            sessionmaker,
            mailer,
            clerk,
            settings,
            NOW + timedelta(days=days),
            clock=fixed(NOW + timedelta(days=days)),
        )

    assert mailer.sent == []
    assert await notice_of(verify_session, seeded.user) is None
    await assert_untouched(verify_session, seeded)


async def test_an_unrecorded_warning_is_sent_again(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    seeded = await seed_user(verify_session, clerk, store)

    async def failing_record(*_args: object, **_kwargs: object) -> bool:
        msg = "database went away"
        raise RuntimeError(msg)

    with monkeypatch.context() as patch:
        patch.setattr(sweep_module, "_record_warning", failing_record)
        assert (
            await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 0
        )
    assert len(mailer.sent) == 1
    assert await notice_of(verify_session, seeded.user) is None

    later = NOW + timedelta(days=1)
    assert (
        await run_inactivity(sessionmaker, mailer, clerk, settings, later, clock=fixed(later)) == 1
    )
    first_key = idempotency_key(seeded.user.id, ACTIVE_SINCE, Step.FIRST)
    assert [key for _, key in mailer.sent] == [first_key, first_key]
    notice = await notice_of(verify_session, seeded.user)
    assert notice.first_sent_at == later
    assert notice.deletion_due_at == later + FIRST_NOTICE

    # The schedule counts from the recorded send, so the old dates delete nothing.
    await run_inactivity(sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT))
    await run_inactivity(
        sessionmaker,
        mailer,
        clerk,
        settings,
        DELETE_AT + timedelta(days=1),
        clock=fixed(DELETE_AT + timedelta(days=1)),
    )
    await assert_untouched(verify_session, seeded)
    notice = await notice_of(verify_session, seeded.user)
    assert notice.second_sent_at == DELETE_AT
    assert notice.deletion_due_at == DELETE_AT + timedelta(days=7)


async def test_a_rate_limited_pass_stops_warning_but_still_deletes(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    # Their first warning falls due at DELETE_AT, after the account seeded below is deleted.
    waiting = [
        await seed_user(
            verify_session,
            clerk,
            store,
            last_synced_at=ACTIVE_SINCE + timedelta(days=30),
            email=f"waiting{n}@example.com",
        )
        for n in range(3)
    ]
    # Seeded last, so it sorts after the accounts whose warnings the pass skips.
    warned = await seed_user(verify_session, clerk, store)
    for at in (NOW, SECOND_AT):
        await run_inactivity(sessionmaker, mailer, clerk, settings, at, clock=fixed(at))
    sent_before = len(mailer.sent)

    attempts: list[str] = []
    lookups: list[str] = []
    real_find = clerk.find_user

    async def find_user(account: str) -> ClerkUser | None:
        lookups.append(account)
        return await real_find(account)

    async def send(message: EmailMessage, *, idempotency_key: str) -> None:
        attempts.append(message.to)
        raise MailerRateLimitedError

    monkeypatch.setattr(clerk, "find_user", find_user)
    monkeypatch.setattr(mailer, "send", send)
    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 1
    )

    assert attempts == ["waiting0@example.com"]
    assert lookups == [waiting[0].user.clerk_user_id]
    assert len(mailer.sent) == sent_before
    for account in waiting:
        assert await notice_of(verify_session, account.user) is None
    await refreshed(verify_session, warned.recording, warned.scan)
    assert warned.recording.deleted_at == DELETE_AT
    assert warned.scan.deleted_at == DELETE_AT

    monkeypatch.undo()
    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 3
    )
    assert sorted(message.to for message, _ in mailer.sent[sent_before:]) == [
        "waiting0@example.com",
        "waiting1@example.com",
        "waiting2@example.com",
    ]
    for account in waiting:
        notice = await notice_of(verify_session, account.user)
        assert notice is not None
        assert notice.first_sent_at == DELETE_AT


async def test_only_one_recorded_warning_never_deletes(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 1
    mailer.error = MailerUnavailableError("refused")

    for days in (23, 30, 31, 60, 400, 4000):
        assert (
            await run_inactivity(
                sessionmaker,
                mailer,
                clerk,
                settings,
                NOW + timedelta(days=days),
                clock=fixed(NOW + timedelta(days=days)),
            )
            == 0
        )

    notice = await notice_of(verify_session, seeded.user)
    assert notice.first_sent_at == NOW
    assert notice.second_sent_at is None
    await assert_untouched(verify_session, seeded)


async def test_a_sync_after_the_first_warning_resets_the_notice(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))
    await sync(verify_session, seeded.user, NOW + timedelta(days=2))

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, SECOND_AT, clock=fixed(SECOND_AT)
        )
        == 1
    )
    assert await notice_of(verify_session, seeded.user) is None
    for days in (30, 60):
        await run_inactivity(
            sessionmaker,
            mailer,
            clerk,
            settings,
            NOW + timedelta(days=days),
            clock=fixed(NOW + timedelta(days=days)),
        )
    await assert_untouched(verify_session, seeded)
    assert len(mailer.sent) == 1


async def test_a_sync_before_deletion_keeps_everything(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))
    await run_inactivity(sessionmaker, mailer, clerk, settings, SECOND_AT, clock=fixed(SECOND_AT))
    await sync(verify_session, seeded.user, SECOND_AT + timedelta(days=1))

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 1
    )
    assert await notice_of(verify_session, seeded.user) is None
    await run_inactivity(
        sessionmaker,
        mailer,
        clerk,
        settings,
        DELETE_AT + timedelta(days=1),
        clock=fixed(DELETE_AT + timedelta(days=1)),
    )
    await assert_untouched(verify_session, seeded)
    assert len(mailer.sent) == 2


async def test_premium_before_deletion_keeps_everything(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))
    await run_inactivity(sessionmaker, mailer, clerk, settings, SECOND_AT, clock=fixed(SECOND_AT))
    verify_session.add(
        Grant(
            user_id=seeded.user.id,
            kind=GrantKind.PREMIUM.value,
            source=GrantSource.COMP.value,
            expires_at=None,
        )
    )
    await verify_session.commit()

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
        )
        == 1
    )
    assert await notice_of(verify_session, seeded.user) is None
    await run_inactivity(
        sessionmaker,
        mailer,
        clerk,
        settings,
        DELETE_AT + timedelta(days=400),
        clock=fixed(DELETE_AT + timedelta(days=400)),
    )
    await assert_untouched(verify_session, seeded)
    assert len(mailer.sent) == 2


async def test_an_empty_or_premium_account_gets_no_mail(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    await seed_user(verify_session, clerk, store, files=False, email="empty@example.com")
    premium = await seed_user(verify_session, clerk, store, email="premium@example.com")
    lapsed = await seed_user(verify_session, clerk, store, email="lapsed@example.com")
    verify_session.add_all(
        [
            Grant(
                user_id=premium.user.id,
                kind=GrantKind.PREMIUM.value,
                source=GrantSource.TRIAL.value,
                expires_at=NOW + timedelta(seconds=1),
            ),
            Grant(
                user_id=lapsed.user.id,
                kind=GrantKind.PREMIUM.value,
                source=GrantSource.TRIAL.value,
                expires_at=NOW,
            ),
            Grant(
                user_id=lapsed.user.id,
                kind=GrantKind.STORAGE_ADDON.value,
                source=GrantSource.COMP.value,
                expires_at=None,
            ),
        ]
    )
    await verify_session.commit()

    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 1
    assert [message.to for message, _ in mailer.sent] == ["lapsed@example.com"]


async def test_an_account_not_yet_due_gets_no_mail(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(
        verify_session, clerk, store, last_synced_at=ACTIVE_SINCE + timedelta(seconds=1)
    )
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 0
    assert mailer.sent == []
    assert clerk.looked_up == []
    assert await notice_of(verify_session, seeded.user) is None


async def test_one_failing_account_leaves_the_others(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    broken = await seed_user(verify_session, clerk, store, email="broken@example.com")
    fine = await seed_user(verify_session, clerk, store, email="fine@example.com")
    real_find = clerk.find_user

    async def find_user(account: str) -> ClerkUser | None:
        if account == broken.user.clerk_user_id:
            msg = "down"
            raise ClerkUnavailableError(msg)
        return await real_find(account)

    monkeypatch.setattr(clerk, "find_user", find_user)
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 1
    assert [message.to for message, _ in mailer.sent] == ["fine@example.com"]
    assert await notice_of(verify_session, broken.user) is None
    assert await notice_of(verify_session, fine.user) is not None


async def test_the_delete_rechecks_under_the_lock(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    verify_session.add(
        InactivityNotice(
            user_id=seeded.user.id,
            active_since=ACTIVE_SINCE,
            first_sent_at=NOW,
            second_sent_at=SECOND_AT,
            deletion_due_at=DELETE_AT,
        )
    )
    await verify_session.commit()
    synced = []

    async def lock_after_a_sync(session: AsyncSession, user_id: uuid.UUID) -> None:
        if not synced:
            async with sessionmaker() as other, other.begin():
                await other.execute(
                    update(User).where(User.id == user_id).values(last_synced_at=DELETE_AT)
                )
            synced.append(user_id)
        await real_lock_user(session, user_id)

    monkeypatch.setattr(sweep_module, "lock_user", lock_after_a_sync)
    await run_inactivity(sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT))

    assert synced == [seeded.user.id]
    await assert_untouched(verify_session, seeded)
    assert mailer.sent == []


async def test_a_sync_during_the_send_records_nothing(
    sessionmaker, verify_session, settings: Settings, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)

    class SyncingMailer(FakeMailer):
        async def send(self, message: EmailMessage, *, idempotency_key: str) -> None:
            await super().send(message, idempotency_key=idempotency_key)
            async with sessionmaker() as other, other.begin():
                await other.execute(
                    update(User).where(User.id == seeded.user.id).values(last_synced_at=NOW)
                )

    mailer = SyncingMailer()
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW)) == 0
    assert len(mailer.sent) == 1
    assert await notice_of(verify_session, seeded.user) is None


async def test_warnings_count_from_when_they_were_sent(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    slow = timedelta(minutes=10)

    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW + slow))
    notice = await notice_of(verify_session, seeded.user)
    assert notice.first_sent_at == NOW + slow
    # Printed from the decision instant, recorded from the send: never earlier than printed.
    assert notice.deletion_due_at == DELETE_AT + slow
    assert notice.deletion_due_at >= DELETE_AT

    second_pass = SECOND_AT + slow
    await run_inactivity(
        sessionmaker, mailer, clerk, settings, second_pass, clock=fixed(second_pass + slow)
    )
    notice = await notice_of(verify_session, seeded.user)
    second_sent = second_pass + slow
    assert notice.second_sent_at == second_sent
    assert notice.deletion_due_at == second_sent + timedelta(days=7)

    early = second_sent - slow + timedelta(days=7)
    await run_inactivity(sessionmaker, mailer, clerk, settings, early, clock=fixed(early))
    await assert_untouched(verify_session, seeded)

    due = second_sent + timedelta(days=7)
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, due, clock=fixed(due)) == 1
    await refreshed(verify_session, seeded.recording)
    assert seeded.recording.deleted_at == due


async def test_premium_between_the_warnings_resets_them(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))
    verify_session.add(
        Grant(
            user_id=seeded.user.id,
            kind=GrantKind.PREMIUM.value,
            source=GrantSource.COMP.value,
            expires_at=None,
        )
    )
    await verify_session.commit()

    assert (
        await run_inactivity(
            sessionmaker, mailer, clerk, settings, SECOND_AT, clock=fixed(SECOND_AT)
        )
        == 1
    )
    assert await notice_of(verify_session, seeded.user) is None
    assert len(mailer.sent) == 1

    for days in (30, 31, 60, 400, 4000):
        moment = NOW + timedelta(days=days)
        await run_inactivity(sessionmaker, mailer, clerk, settings, moment, clock=fixed(moment))
    await assert_untouched(verify_session, seeded)
    assert len(mailer.sent) == 1
    assert await notice_of(verify_session, seeded.user) is None


async def test_a_late_pass_dates_deletion_from_the_second_warning(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))

    late = NOW + timedelta(days=200)
    assert await run_inactivity(sessionmaker, mailer, clerk, settings, late, clock=fixed(late)) == 1
    notice = await notice_of(verify_session, seeded.user)
    assert notice.second_sent_at == late
    due = late + timedelta(days=7)
    assert notice.deletion_due_at == due

    before = due - timedelta(seconds=1)
    assert (
        await run_inactivity(sessionmaker, mailer, clerk, settings, before, clock=fixed(before))
        == 0
    )
    await assert_untouched(verify_session, seeded)

    assert await run_inactivity(sessionmaker, mailer, clerk, settings, due, clock=fixed(due)) == 1
    await refreshed(verify_session, seeded.recording, seeded.scan)
    assert seeded.recording.deleted_at == due
    assert seeded.scan.deleted_at == due


def _frame_locals(error: BaseException) -> list[str]:
    """The repr of every local in every frame of `error` and the errors it chains to."""
    reprs = []
    seen: BaseException | None = error
    while seen is not None:
        tb = seen.__traceback__
        while tb is not None:
            reprs += [repr(value) for value in tb.tb_frame.f_locals.values()]
            tb = tb.tb_next
        seen = seen.__cause__ or seen.__context__
    return reprs


def _failure_records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [record for record in caplog.records if record.name == sweep_module.__name__]


async def test_a_failed_record_reports_no_address_or_body(
    sessionmaker,
    verify_session,
    settings: Settings,
    clerk,
    store,
    monkeypatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    seeded = await seed_user(verify_session, clerk, store)
    mailer = FakeMailer()

    async def failing_lock(_session: AsyncSession, _user_id: uuid.UUID) -> None:
        msg = "database went away"
        raise RuntimeError(msg)

    monkeypatch.setattr(sweep_module, "lock_user", failing_lock)
    with caplog.at_level(logging.INFO, logger=sweep_module.__name__):
        await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))

    assert len(mailer.sent) == 1
    body = mailer.sent[0][0].text.split("\n")[0]
    (record,) = [r for r in _failure_records(caplog) if r.exc_info]
    assert record.exc_info is not None
    assert isinstance(record.exc_info[1], RuntimeError)
    reprs = _frame_locals(record.exc_info[1])
    assert any(str(seeded.user.id) in value for value in reprs)
    assert not [value for value in reprs if EMAIL in value or body in value]


async def test_an_unexpected_send_failure_reports_no_address_or_body(
    sessionmaker,
    verify_session,
    settings: Settings,
    clerk,
    store,
    caplog: pytest.LogCaptureFixture,
) -> None:
    seeded = await seed_user(verify_session, clerk, store)

    class BrokenMailer(FakeMailer):
        async def send(self, message: EmailMessage, *, idempotency_key: str) -> None:
            raise RuntimeError(message.to)

    with caplog.at_level(logging.INFO, logger=sweep_module.__name__):
        assert (
            await run_inactivity(
                sessionmaker, BrokenMailer(), clerk, settings, NOW, clock=fixed(NOW)
            )
            == 0
        )

    (record,) = [r for r in _failure_records(caplog) if r.exc_info]
    error = record.exc_info[1]
    assert isinstance(error, sweep_module.WarningNotSentError)
    assert "RuntimeError" in str(error)
    assert error.__cause__ is None
    assert error.__context__ is None
    assert not [value for value in _frame_locals(error) if EMAIL in value]
    assert await notice_of(verify_session, seeded.user) is None


@pytest.mark.parametrize("failure", ["clerk-down", "mailer-refuses"])
async def test_a_refused_lookup_or_send_logs_no_address(
    sessionmaker,
    verify_session,
    settings: Settings,
    clerk,
    store,
    caplog: pytest.LogCaptureFixture,
    failure: str,
) -> None:
    await seed_user(verify_session, clerk, store)
    mailer = FakeMailer()
    if failure == "clerk-down":
        clerk.error = ClerkUnavailableError(f"down for {EMAIL}")
    else:
        mailer.error = MailerUnavailableError(f"refused {EMAIL}")

    with caplog.at_level(logging.INFO, logger=sweep_module.__name__):
        await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))

    (record,) = _failure_records(caplog)
    assert record.levelno == logging.WARNING
    assert record.exc_info is None
    assert EMAIL not in record.getMessage()
    assert not [value for value in vars(record).values() if EMAIL in repr(value)]


def _deleting_lock(
    sessionmaker: async_sessionmaker[AsyncSession], victim: uuid.UUID, deleted: list[uuid.UUID]
) -> Callable[[AsyncSession, uuid.UUID], Awaitable[None]]:
    """A lock_user that first deletes the victim's account, as a purge between read and lock."""

    async def lock(session: AsyncSession, user_id: uuid.UUID) -> None:
        if user_id == victim and not deleted:
            async with sessionmaker() as other, other.begin():
                await other.execute(delete(User).where(User.id == user_id))
            deleted.append(user_id)
        await real_lock_user(session, user_id)

    return lock


async def _user_exists(session: AsyncSession, user: User) -> bool:
    return (await session.scalar(select(User.id).where(User.id == user.id))) is not None


async def test_an_account_deleted_before_its_files_are_deleted_is_skipped(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    victim = await seed_user(verify_session, clerk, store)
    other = await seed_user(verify_session, clerk, store)
    for seeded in (victim, other):
        verify_session.add(
            InactivityNotice(
                user_id=seeded.user.id,
                active_since=ACTIVE_SINCE,
                first_sent_at=NOW,
                second_sent_at=SECOND_AT,
                deletion_due_at=DELETE_AT,
            )
        )
    await verify_session.commit()
    deleted: list[uuid.UUID] = []
    monkeypatch.setattr(
        sweep_module, "lock_user", _deleting_lock(sessionmaker, victim.user.id, deleted)
    )

    changed = await run_inactivity(
        sessionmaker, mailer, clerk, settings, DELETE_AT, clock=fixed(DELETE_AT)
    )

    assert deleted == [victim.user.id]
    assert changed == 1
    assert not await _user_exists(verify_session, victim.user)
    assert await notice_of(verify_session, victim.user) is None
    await refreshed(verify_session, other.recording)
    assert other.recording.deleted_at == DELETE_AT
    assert mailer.sent == []


async def test_an_account_deleted_while_its_warning_is_sent_records_nothing(
    sessionmaker, verify_session, settings: Settings, mailer, clerk, store, monkeypatch
) -> None:
    victim = await seed_user(verify_session, clerk, store, email="victim@example.com")
    other = await seed_user(verify_session, clerk, store, email="other@example.com")
    deleted: list[uuid.UUID] = []
    monkeypatch.setattr(
        sweep_module, "lock_user", _deleting_lock(sessionmaker, victim.user.id, deleted)
    )

    changed = await run_inactivity(sessionmaker, mailer, clerk, settings, NOW, clock=fixed(NOW))

    assert deleted == [victim.user.id]
    assert changed == 1
    assert sorted(message.to for message, _ in mailer.sent) == [
        "other@example.com",
        "victim@example.com",
    ]
    assert not await _user_exists(verify_session, victim.user)
    assert await notice_of(verify_session, victim.user) is None
    assert await notice_of(verify_session, other.user) is not None
