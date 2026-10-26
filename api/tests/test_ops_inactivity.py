"""The inactivity operator command."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from pydantic import SecretStr
from sqlalchemy import select

from crosstune.config import Settings
from crosstune.db.base import new_uuid7
from crosstune.db.engine import make_sessionmaker
from crosstune.email.resend import MailerRateLimitedError, MailerUnavailableError
from crosstune.inactivity.rules import FIRST_NOTICE, INACTIVE_AFTER, NoticeState
from crosstune.inactivity.sweep import Account
from crosstune.models import Grant, InactivityNotice, Recording, User
from crosstune.ops import billing, inactivity
from crosstune.vocabulary import GrantKind, GrantSource
from tests.fakes import FakeClerkUsers, FakeMailer

if TYPE_CHECKING:
    import argparse

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

pytestmark = pytest.mark.anyio

NOW = datetime(2027, 3, 1, 9, 0, tzinfo=UTC)
ACTIVE_SINCE = NOW - INACTIVE_AFTER + FIRST_NOTICE
EMAIL = "musician@example.com"


@pytest.fixture
def sessionmaker(engine) -> async_sessionmaker[AsyncSession]:
    return make_sessionmaker(engine)


async def _seed(
    session: AsyncSession,
    clerk: FakeClerkUsers,
    *,
    synced: datetime | None = ACTIVE_SINCE,
    recordings: int = 1,
    email: str | None = EMAIL,
) -> User:
    clerk_id = f"user_{uuid.uuid4().hex[:12]}"
    clerk.users[clerk_id] = email
    at = ACTIVE_SINCE - timedelta(days=60)
    user = User(
        id=new_uuid7(), clerk_user_id=clerk_id, email=email, created_at=at, last_synced_at=synced
    )
    session.add(user)
    await session.flush()
    for _ in range(recordings):
        session.add(
            Recording(
                id=new_uuid7(),
                user_id=user.id,
                source="microphone",
                added_at=at,
                recorded_at=at,
                recorded_precision="time",
                created_at=at,
                updated_at=at,
                state="ready",
                playback_bytes=3,
            )
        )
    await session.commit()
    return user


def _args(*argv: str) -> argparse.Namespace:
    return inactivity.build_parser().parse_args(argv)


async def test_preview_of_a_fresh_account_names_when_the_first_warning_is_due(
    verify_session: AsyncSession, sessionmaker
) -> None:
    clerk = FakeClerkUsers()
    user = await _seed(verify_session, clerk)
    lines = await inactivity.preview(sessionmaker, user.clerk_user_id, NOW)
    text = "\n".join(lines)
    assert "last sync" in text
    assert "premium no" in text
    assert "recordings 1" in text
    assert "notice none" in text
    assert "next step first" in text
    assert EMAIL not in text


async def test_preview_by_email_of_an_account_never_synced_says_creation(
    verify_session: AsyncSession, sessionmaker
) -> None:
    clerk = FakeClerkUsers()
    await _seed(verify_session, clerk, synced=None)
    text = "\n".join(await inactivity.preview(sessionmaker, EMAIL, NOW))
    assert "creation" in text


async def test_preview_shows_the_stored_deletion_date_and_writes_nothing(
    verify_session: AsyncSession, sessionmaker
) -> None:
    clerk = FakeClerkUsers()
    user = await _seed(verify_session, clerk)
    first, second = NOW - timedelta(days=30), NOW - timedelta(days=8)
    due = NOW - timedelta(days=1)
    verify_session.add(
        InactivityNotice(
            user_id=user.id,
            active_since=ACTIVE_SINCE,
            first_sent_at=first,
            second_sent_at=second,
            deletion_due_at=due,
        )
    )
    await verify_session.commit()
    text = "\n".join(await inactivity.preview(sessionmaker, user.clerk_user_id, NOW))
    assert "next step delete" in text
    assert due.isoformat() in text
    assert (
        await verify_session.scalar(
            select(InactivityNotice.deletion_due_at).where(InactivityNotice.user_id == user.id)
        )
    ) == due


async def test_preview_says_so_for_a_corrupt_notice(
    verify_session: AsyncSession, sessionmaker
) -> None:
    clerk = FakeClerkUsers()
    user = await _seed(verify_session, clerk)
    verify_session.add(
        InactivityNotice(
            user_id=user.id,
            active_since=ACTIVE_SINCE,
            first_sent_at=NOW,
            second_sent_at=None,
            deletion_due_at=None,
        )
    )
    await verify_session.commit()
    text = "\n".join(await inactivity.preview(sessionmaker, user.clerk_user_id, NOW))
    assert "corrupt" in text


async def test_preview_counts_premium(verify_session: AsyncSession, sessionmaker) -> None:
    clerk = FakeClerkUsers()
    user = await _seed(verify_session, clerk)
    verify_session.add(
        Grant(
            user_id=user.id,
            kind=GrantKind.PREMIUM.value,
            source=GrantSource.COMP.value,
            expires_at=None,
        )
    )
    await verify_session.commit()
    text = "\n".join(await inactivity.preview(sessionmaker, user.clerk_user_id, NOW))
    assert "premium yes" in text
    assert "next step none" in text


async def test_preview_of_an_unknown_account_is_refused(sessionmaker) -> None:
    with pytest.raises(billing.BillingCommandError, match="no account"):
        await inactivity.preview(sessionmaker, "user_missing", NOW)


async def test_send_test_mails_the_clerk_address_with_a_fresh_key_and_records_nothing(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    user = await _seed(verify_session, clerk)
    line = await inactivity.send_test(
        sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
    )
    again = await inactivity.send_test(
        sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
    )
    assert line == again == "sent: Resend accepted the message"
    assert EMAIL not in line
    (message, key), (_, key2) = mailer.sent
    assert message.to == EMAIL
    assert "1 recording" in message.text
    assert key.startswith("inactivity-test/")
    assert key != key2
    assert await verify_session.scalar(select(InactivityNotice)) is None


async def test_send_test_second_notice_uses_the_stored_deletion_date(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    user = await _seed(verify_session, clerk)
    due = datetime(2027, 4, 15, tzinfo=UTC)
    verify_session.add(
        InactivityNotice(
            user_id=user.id,
            active_since=ACTIVE_SINCE,
            first_sent_at=NOW - timedelta(days=1),
            second_sent_at=None,
            deletion_due_at=due,
        )
    )
    await verify_session.commit()
    await inactivity.send_test(
        sessionmaker, mailer, clerk, user.clerk_user_id, "second", settings, NOW
    )
    assert "April 15, 2027" in mailer.sent[0][0].text


async def test_send_test_fails_when_resend_refuses(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    mailer.error = MailerUnavailableError("Resend answered 403 sending an email")
    user = await _seed(verify_session, clerk)
    with pytest.raises(billing.BillingCommandError, match=r"not sent.*403"):
        await inactivity.send_test(
            sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
        )


async def test_send_test_reports_a_rate_limit_as_not_sent(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    mailer.error = MailerRateLimitedError("Resend answered 429 sending an email")
    user = await _seed(verify_session, clerk)
    with pytest.raises(billing.BillingCommandError, match=r"not sent.*429"):
        await inactivity.send_test(
            sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
        )


async def test_send_test_refuses_an_account_without_live_files(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    user = await _seed(verify_session, clerk, recordings=0)
    with pytest.raises(billing.BillingCommandError, match="no live recordings or scans"):
        await inactivity.send_test(
            sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
        )
    assert mailer.sent == []
    assert clerk.looked_up == []


async def test_send_test_without_a_clerk_email_sends_nothing(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    user = await _seed(verify_session, clerk, email=None)
    with pytest.raises(billing.BillingCommandError, match="no email"):
        await inactivity.send_test(
            sessionmaker, mailer, clerk, user.clerk_user_id, "first", settings, NOW
        )
    assert mailer.sent == []


async def test_run_takes_one_pass_and_reports_the_count(
    verify_session: AsyncSession, sessionmaker, settings: Settings
) -> None:
    clerk = FakeClerkUsers()
    mailer = FakeMailer()
    user = await _seed(verify_session, clerk)
    line = await inactivity.run_now(sessionmaker, mailer, clerk, settings, NOW)
    assert line == "1 account changed"
    assert len(mailer.sent) == 1
    notice = await verify_session.scalar(
        select(InactivityNotice)
        .where(InactivityNotice.user_id == user.id)
        .execution_options(populate_existing=True)
    )
    assert notice is not None
    assert notice.first_sent_at is not None


def test_send_test_and_run_refuse_without_a_mailer_or_clerk(settings: Settings) -> None:
    with pytest.raises(billing.BillingCommandError, match="CROSSTUNE_RESEND_API_KEY"):
        inactivity.require_clients(settings)
    keyed = Settings(database_url=settings.database_url, resend_api_key="re_x", clerk_secret_key="")
    with pytest.raises(billing.BillingCommandError, match="CROSSTUNE_CLERK_SECRET_KEY"):
        inactivity.require_clients(keyed)


def test_the_parser_reads_each_subcommand() -> None:
    assert _args("preview", "user_a").command == "preview"
    assert _args("send-test", "a@b.co", "--notice", "second").notice == "second"
    assert _args("run", "--yes").yes is True
    with pytest.raises(SystemExit):
        _args("send-test", "user_a")


def _account(**changes: object) -> Account:
    base = {
        "user_id": uuid.uuid4(),
        "clerk_user_id": "user_x",
        "active_since": ACTIVE_SINCE,
        "premium": False,
        "recordings": 1,
        "scans": 0,
        "notice": None,
    }
    return Account(**{**base, **changes})  # type: ignore[arg-type]


def _notice(**changes: datetime | None) -> NoticeState:
    base = {
        "active_since": ACTIVE_SINCE,
        "first_sent_at": NOW,
        "second_sent_at": None,
        "deletion_due_at": NOW + timedelta(days=30),
    }
    return NoticeState(**{**base, **changes})  # type: ignore[arg-type]


def test_waiting_line_for_premium_and_empty_accounts() -> None:
    assert inactivity._waiting_line(_account(premium=True)) == "no warning: premium"
    assert (
        inactivity._waiting_line(_account(recordings=0, scans=0))
        == "no warning: no live recordings or scans"
    )


def test_waiting_line_before_any_warning() -> None:
    due = (ACTIVE_SINCE + INACTIVE_AFTER - FIRST_NOTICE).isoformat()
    expected = f"first warning due {due}"
    assert inactivity._waiting_line(_account()) == expected
    unsent = _notice(first_sent_at=None, deletion_due_at=None)
    assert inactivity._waiting_line(_account(notice=unsent)) == expected


def test_waiting_line_between_the_warnings() -> None:
    line = inactivity._waiting_line(_account(notice=_notice()))
    assert line == f"second warning due {(NOW + timedelta(days=23)).isoformat()}"


def test_waiting_line_after_the_second_warning() -> None:
    second = NOW + timedelta(days=25)
    notice = _notice(second_sent_at=second)
    line = inactivity._waiting_line(_account(notice=notice))
    assert line == f"deletion due {(second + timedelta(days=7)).isoformat()}"


def test_waiting_line_for_a_corrupt_notice() -> None:
    line = inactivity._waiting_line(_account(notice=_notice(deletion_due_at=None)))
    assert line.startswith("corrupt notice")


PRODUCTION = Settings.model_construct(
    environment="production", database_url="postgresql+asyncpg://u@db.example/crosstune"
)


class _UnusedEngine:
    """Replaces the command's engine where no test reaches the database."""

    async def dispose(self) -> None:
        return None


@pytest.fixture
def no_database(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep `main` from building an engine for the fake production URL."""
    monkeypatch.setattr(inactivity, "make_engine", lambda _url: _UnusedEngine())
    monkeypatch.setattr(inactivity, "make_sessionmaker", lambda _engine: None)


@pytest.mark.usefixtures("no_database")
@pytest.mark.parametrize("argv", [["send-test", "user_x", "--notice", "first"], ["run"]])
def test_main_refuses_production_without_yes(
    argv: list[str], monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(inactivity, "load_settings", lambda: PRODUCTION)
    assert inactivity.main(argv) == 1
    assert "pass --yes" in capsys.readouterr().err


@pytest.mark.usefixtures("no_database")
def test_main_previews_production_without_yes(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fake_preview(*_args: object) -> list[str]:
        return ["previewed"]

    monkeypatch.setattr(inactivity, "load_settings", lambda: PRODUCTION)
    monkeypatch.setattr(inactivity, "preview", fake_preview)
    assert inactivity.main(["preview", "user_x"]) == 0
    assert "previewed" in capsys.readouterr().out


@pytest.mark.usefixtures("no_database")
def test_main_exits_1_for_an_unknown_account(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fake_preview(*_args: object) -> list[str]:
        msg = "no account matches user_x"
        raise billing.BillingCommandError(msg)

    monkeypatch.setattr(inactivity, "load_settings", lambda: PRODUCTION)
    monkeypatch.setattr(inactivity, "preview", fake_preview)
    assert inactivity.main(["preview", "user_x"]) == 1
    assert "no account matches" in capsys.readouterr().err


@pytest.mark.usefixtures("no_database")
def test_main_exits_1_when_resend_refuses_a_test_send(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    keyed = Settings.model_construct(
        environment="production",
        database_url="postgresql+asyncpg://u@db.example/crosstune",
        resend_api_key=SecretStr("re_x"),
        clerk_secret_key=SecretStr("sk_x"),
    )
    clerk = FakeClerkUsers({"user_x": EMAIL})
    mailer = FakeMailer()
    mailer.error = MailerUnavailableError("Resend answered 403 sending an email")

    async def fake_load(*_args: object) -> tuple[Account, bool]:
        return _account(), True

    monkeypatch.setattr(inactivity, "load_settings", lambda: keyed)
    monkeypatch.setattr(inactivity, "_load", fake_load)
    monkeypatch.setattr(inactivity, "ResendMailer", lambda *_a, **_k: mailer)
    monkeypatch.setattr(inactivity, "ClerkBackendUsers", lambda *_a, **_k: clerk)

    assert inactivity.main(["send-test", "user_x", "--notice", "first", "--yes"]) == 1
    captured = capsys.readouterr()
    assert "not sent: Resend answered 403" in captured.err
    assert "sent: Resend accepted" not in captured.out
    assert EMAIL not in captured.err
    assert clerk.looked_up == ["user_x"]


def test_preview_takes_no_yes_flag() -> None:
    with pytest.raises(SystemExit):
        _args("preview", "user_x", "--yes")
