"""The operator command that emails every account about a change to the terms."""

from __future__ import annotations

import io
import sys
from datetime import UTC, datetime
from typing import TYPE_CHECKING

import anyio.to_thread
import pytest
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.exc import OperationalError

from crosstune.config import Settings
from crosstune.db.base import new_uuid7
from crosstune.db.locks import release_notice_lock, try_notice_lock
from crosstune.email.resend import MailerUnavailableError
from crosstune.models import AccountNotice, User
from crosstune.ops import notify_accounts
from crosstune.ops.billing import BillingCommandError
from tests.fakes import FakeMailer

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

pytestmark = pytest.mark.anyio

NOW = datetime(2027, 3, 1, 9, 0, tzinfo=UTC)
KEY = "terms-2027-04"
BODY = "We are changing the terms.\n\nRead them at https://crosstune.app/terms and\nhttps://crosstune.app/terms/changes."


async def _users(session: AsyncSession, with_email: int, without_email: int = 0) -> list[User]:
    users = [
        User(
            id=new_uuid7(),
            clerk_user_id=f"user_{new_uuid7().hex[-12:]}",
            email=f"person{index}@example.com" if index < with_email else None,
            created_at=NOW,
        )
        for index in range(with_email + without_email)
    ]
    session.add_all(users)
    await session.flush()
    return users


def _args(*argv: str) -> object:
    return notify_accounts.build_parser().parse_args(["--subject", "Terms", "--key", KEY, *argv])


async def _noticed(session: AsyncSession) -> int:
    return await session.scalar(select(func.count()).select_from(AccountNotice)) or 0


async def test_dry_run_counts_and_sends_nothing(
    session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    await _users(session, 3, without_email=2)
    mailer = FakeMailer()

    code = await notify_accounts.execute(session, mailer, _args("--body", "-"), BODY)

    assert code == 0
    assert "would email 3 accounts" in capsys.readouterr().out
    assert mailer.sent_batches == []
    assert await _noticed(session) == 0


async def test_send_batches_of_100_and_records_notices(session: AsyncSession) -> None:
    users = await _users(session, 250, without_email=4)
    mailer = FakeMailer()

    code = await notify_accounts.execute(session, mailer, _args("--body", "-", "--yes"), BODY)

    assert code == 0
    assert [len(batch) for batch, _ in mailer.sent_batches] == [100, 100, 50]
    recipients = {message.to for batch, _ in mailer.sent_batches for message in batch}
    assert recipients == {user.email for user in users if user.email}
    keys = [key for _, key in mailer.sent_batches]
    assert len(set(keys)) == 3
    assert keys[0] == f"{KEY}:{min(user.id for user in users if user.email)}"
    assert await _noticed(session) == 250


async def test_rerun_sends_nothing(
    session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    await _users(session, 5)
    first = FakeMailer()
    await notify_accounts.execute(session, first, _args("--body", "-", "--yes"), BODY)
    second = FakeMailer()

    code = await notify_accounts.execute(session, second, _args("--body", "-", "--yes"), BODY)

    assert code == 0
    assert second.sent_batches == []
    assert "no accounts to email" in capsys.readouterr().out


async def test_a_new_key_emails_everyone_again(session: AsyncSession) -> None:
    await _users(session, 2)
    await notify_accounts.execute(session, FakeMailer(), _args("--body", "-", "--yes"), BODY)
    mailer = FakeMailer()
    args = notify_accounts.build_parser().parse_args(
        ["--subject", "Privacy", "--key", "privacy-change", "--body", "-", "--yes"]
    )

    await notify_accounts.execute(session, mailer, args, BODY)

    assert [len(batch) for batch, _ in mailer.sent_batches] == [2]


async def test_rate_limit_records_only_sent_batches_and_returns_1(
    session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    await _users(session, 250)
    mailer = FakeMailer()
    mailer.rate_limit_after_batches = 1

    code = await notify_accounts.execute(session, mailer, _args("--body", "-", "--yes"), BODY)

    assert code == 1
    assert len(mailer.sent_batches) == 1
    assert await _noticed(session) == 100
    assert "sent 100, 150 remain; run again later or move Resend to Pro" in capsys.readouterr().out

    rerun = FakeMailer()
    await notify_accounts.execute(session, rerun, _args("--body", "-", "--yes"), BODY)
    assert [len(batch) for batch, _ in rerun.sent_batches] == [100, 50]
    assert await _noticed(session) == 250


async def test_other_mail_failure_stops_and_returns_1(
    session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    await _users(session, 3)
    mailer = FakeMailer()
    mailer.error = MailerUnavailableError("down")

    code = await notify_accounts.execute(session, mailer, _args("--body", "-", "--yes"), BODY)

    assert code == 1
    assert await _noticed(session) == 0
    assert "sent 0, 3 remain" in capsys.readouterr().out


async def test_a_failed_batch_is_retried_with_the_same_key(
    session: AsyncSession, capsys: pytest.CaptureFixture[str]
) -> None:
    users = await _users(session, 3)
    failing = FakeMailer()
    failing.error = MailerUnavailableError("down")
    await notify_accounts.execute(session, failing, _args("--body", "-", "--yes"), BODY)
    printed = capsys.readouterr().out
    assert all(str(user.id) in printed for user in users)
    retry = FakeMailer()

    await notify_accounts.execute(session, retry, _args("--body", "-", "--yes"), BODY)

    ((batch, key),) = retry.sent_batches
    assert len(batch) == 3
    assert key == f"{KEY}:{min(user.id for user in users)}"


async def test_message_has_text_and_linked_html(session: AsyncSession) -> None:
    await _users(session, 1)
    mailer = FakeMailer()

    await notify_accounts.execute(session, mailer, _args("--body", "-", "--yes"), BODY)

    ((batch, _),) = mailer.sent_batches
    (message,) = batch
    assert message.subject == "Terms"
    assert message.text.startswith("We are changing the terms.\n\nRead them at")
    assert message.html.count("<p>") == 2
    assert '<a href="https://crosstune.app/terms">https://crosstune.app/terms</a>' in message.html
    assert (
        '<a href="https://crosstune.app/terms/changes">https://crosstune.app/terms/changes</a>'
        in message.html
    )
    assert message.html.count("<a ") == 2


def test_html_escapes_the_body() -> None:
    message = notify_accounts.build_message("a@example.com", "S", "Use <b> & more")

    assert "&lt;b&gt; &amp; more" in message.html


def test_read_body_from_a_file_and_stdin(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = tmp_path / "email.md"
    path.write_text("From a file.\n")
    monkeypatch.setattr(sys, "stdin", io.StringIO("From stdin.\n"))

    assert notify_accounts.read_body(str(path)) == "From a file.\n"
    assert notify_accounts.read_body("-") == "From stdin.\n"


def test_empty_body_is_refused() -> None:
    with pytest.raises(BillingCommandError, match="empty"):
        notify_accounts.build_message("a@example.com", "S", "  \n\n ")


def test_key_longer_than_the_column_is_refused() -> None:
    with pytest.raises(SystemExit):
        notify_accounts.build_parser().parse_args(
            ["--subject", "S", "--key", "k" * 101, "--body", "-"]
        )


async def test_sending_without_mail_configured_is_refused(session: AsyncSession) -> None:
    await _users(session, 1)

    with pytest.raises(BillingCommandError, match="mail is not configured"):
        await notify_accounts.execute(session, None, _args("--body", "-", "--yes"), BODY)


E2E_SETTINGS = Settings.model_construct(
    environment="development", database_url="postgresql+asyncpg://u@localhost/crosstune_e2e"
)


def _body_file(tmp_path: Path) -> str:
    path = tmp_path / "email.md"
    path.write_text(BODY)
    return str(path)


async def test_main_without_yes_builds_no_mailer(
    settings: Settings,
    verify_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    await _users(verify_session, 2)
    await verify_session.commit()

    def forbidden(*_args: object) -> None:
        pytest.fail("a dry run built a mailer")

    monkeypatch.setattr(notify_accounts, "load_settings", lambda: settings)
    monkeypatch.setattr(notify_accounts, "make_mailer", forbidden)

    code = await anyio.to_thread.run_sync(
        notify_accounts.main, ["--subject", "S", "--key", KEY, "--body", _body_file(tmp_path)]
    )

    assert code == 0
    assert "would email 2 accounts" in capsys.readouterr().out


def test_main_refuses_the_e2e_database_without_the_flag(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(notify_accounts, "load_settings", lambda: E2E_SETTINGS)

    assert notify_accounts.main(["--subject", "S", "--key", KEY, "--body", "-"]) == 1
    assert "e2e" in capsys.readouterr().err


def test_main_reports_an_unreadable_body(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    development = Settings.model_construct(
        environment="development", database_url="postgresql+asyncpg://u@localhost/crosstune"
    )
    monkeypatch.setattr(notify_accounts, "load_settings", lambda: development)

    code = notify_accounts.main(
        ["--subject", "S", "--key", KEY, "--body", str(tmp_path / "missing.md")]
    )

    assert code == 1
    assert "missing.md" in capsys.readouterr().err


def test_main_reports_unusable_settings(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    def bad() -> Settings:
        error = ValidationError.from_exception_data(
            "Settings", [{"type": "missing", "loc": ("resend_api_key",), "input": {}}]
        )
        raise error

    monkeypatch.setattr(notify_accounts, "load_settings", bad)

    assert notify_accounts.main(["--subject", "S", "--key", KEY, "--body", "-"]) == 1
    assert "unusable settings" in capsys.readouterr().err


async def test_a_second_run_for_the_same_key_is_refused(
    settings: Settings,
    engine: AsyncEngine,
    tmp_path: Path,
    capsys: pytest.CaptureFixture[str],
) -> None:
    args = _args("--body", _body_file(tmp_path), "--yes")
    async with engine.connect() as holder:
        assert await try_notice_lock(holder, KEY)
        try:
            code = await notify_accounts.run(settings, args)
        finally:
            await release_notice_lock(holder, KEY)

    assert code == 1
    assert "another run is sending" in capsys.readouterr().err


async def test_a_failed_lock_release_keeps_the_runs_result(
    settings: Settings,
    verify_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    await _users(verify_session, 2)
    await verify_session.commit()
    mailer = FakeMailer()

    async def dropped(*_args: object) -> None:
        msg = "release"
        raise OperationalError(msg, None, ConnectionError())

    monkeypatch.setattr(notify_accounts, "make_mailer", lambda *_: mailer)
    monkeypatch.setattr(notify_accounts, "release_notice_lock", dropped)

    code = await notify_accounts.run(settings, _args("--body", _body_file(tmp_path), "--yes"))

    assert code == 0
    assert len(mailer.sent_batches) == 1
    assert f"could not release the lock on {KEY}" in capsys.readouterr().err
