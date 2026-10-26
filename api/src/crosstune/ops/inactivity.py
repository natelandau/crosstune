"""Operator commands for the inactive-account warnings.

Run as `just api::inactivity`. `preview` reads one account and writes nothing,
`send-test` mails one warning to the account's Clerk address and records nothing, and
`run` takes one pass of the daily job now. Each prints the environment and database it
works on and refuses production without `--yes`, except `preview`, which only reads.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
import uuid
from typing import TYPE_CHECKING

from pydantic import ValidationError

from crosstune.db.base import utc_now
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.email.resend import MailerUnavailableError, ResendMailer
from crosstune.http import public_only_client
from crosstune.inactivity.emails import warning_email
from crosstune.inactivity.rules import (
    FIRST_NOTICE,
    INACTIVE_AFTER,
    SECOND_NOTICE,
    NoticeState,
    Step,
    deletion_due,
)
from crosstune.inactivity.sweep import Account, read_account, run_inactivity
from crosstune.ops.billing import BillingCommandError, check_target, find_user, load_settings
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.email.resend import Mailer
    from crosstune.users.clerk import ClerkUsers

_NOTICE_STEPS = {"first": Step.FIRST, "second": Step.SECOND}


async def _load(
    sessionmaker: async_sessionmaker[AsyncSession], account: str, now: datetime
) -> tuple[Account, bool]:
    """Read the account, and whether its activity came from a sync rather than creation."""
    async with sessionmaker() as session, session.begin():
        user = await find_user(session, account)
        if user is None:
            msg = f"no account matches {account}"
            raise BillingCommandError(msg)
        found = await read_account(session, user.id, now)
        synced = user.last_synced_at is not None
    if found is None:
        msg = f"no account matches {account}"
        raise BillingCommandError(msg)
    return found, synced


def _corrupt(notice: NoticeState | None) -> bool:
    return (
        notice is not None and notice.first_sent_at is not None and notice.deletion_due_at is None
    )


def _deletion_on(account: Account, step: Step, now: datetime) -> datetime:
    """The deletion date the warning for `step` would carry if sent at `now`."""
    notice = account.notice if step is Step.SECOND and not _corrupt(account.notice) else None
    return deletion_due(now=now, active_since=account.active_since, notice=notice)


def _next_line(account: Account, step: Step, now: datetime) -> str:
    notice = account.notice
    due = notice.deletion_due_at if notice else None
    if _corrupt(notice):
        return (
            "corrupt notice: a first warning is recorded with no deletion date, "
            "so the pass will never delete this account"
        )
    if step in (Step.FIRST, Step.SECOND):
        return f"deletion date it would carry {_deletion_on(account, step, now).isoformat()}"
    if step is Step.DELETE and due is not None:
        return f"stored deletion date {due.isoformat()}"
    if step is Step.RESET:
        return "the stored warnings would be forgotten"
    return _waiting_line(account)


def _waiting_line(account: Account) -> str:
    """When the next step falls due for an account the rule leaves alone for now."""
    notice = account.notice
    if account.premium:
        return "no warning: premium"
    if account.recordings + account.scans == 0:
        return "no warning: no live recordings or scans"
    if notice is None or notice.first_sent_at is None:
        first = account.active_since + INACTIVE_AFTER - FIRST_NOTICE
        return f"first warning due {first.isoformat()}"
    if notice.deletion_due_at is None:
        return "corrupt notice: a first warning is recorded with no deletion date"
    if notice.second_sent_at is None:
        return f"second warning due {(notice.deletion_due_at - SECOND_NOTICE).isoformat()}"
    deletes_at = max(notice.deletion_due_at, notice.second_sent_at + SECOND_NOTICE)
    return f"deletion due {deletes_at.isoformat()}"


async def preview(
    sessionmaker: async_sessionmaker[AsyncSession], account: str, now: datetime
) -> list[str]:
    """Describe one account's inactivity state at `now`, writing nothing.

    Returns:
        The lines to print.

    Raises:
        BillingCommandError: No account matches.
    """
    found, synced = await _load(sessionmaker, account, now)
    notice = found.notice
    if notice is None:
        notice_line = "notice none"
    else:
        notice_line = (
            f"notice active since {notice.active_since.isoformat()}, "
            f"first sent {notice.first_sent_at and notice.first_sent_at.isoformat()}, "
            f"second sent {notice.second_sent_at and notice.second_sent_at.isoformat()}, "
            f"deletion due {notice.deletion_due_at and notice.deletion_due_at.isoformat()}"
        )
    step = found.step(now)
    return [
        f"account {found.clerk_user_id}",
        f"activity {found.active_since.isoformat()} (from {'last sync' if synced else 'creation'})",
        f"premium {'yes' if found.premium else 'no'}",
        f"recordings {found.recordings}, scans {found.scans}",
        notice_line,
        f"next step {step.value} at {now.isoformat()}",
        _next_line(found, step, now),
    ]


async def send_test(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    clerk_users: ClerkUsers,
    account: str,
    notice: str,
    settings: Settings,
    now: datetime,
) -> str:
    """Mail the chosen warning to the account's Clerk address now, recording nothing.

    The key is fresh each time, so Resend never answers with an earlier send's result.
    A `second` notice carries the stored deletion date; with no first warning on record
    it carries the date a first warning sent now would set.

    Returns:
        The line to print: whether Resend accepted the message, never the address.

    Raises:
        BillingCommandError: No account matches, it holds no live recordings or scans,
            Clerk has no email for it, or Resend did not accept the message.
    """
    step = _NOTICE_STEPS[notice]
    found, _ = await _load(sessionmaker, account, now)
    if found.recordings + found.scans == 0:
        msg = f"{found.clerk_user_id} holds no live recordings or scans; nothing was sent"
        raise BillingCommandError(msg)
    try:
        clerk_user = await clerk_users.find_user(found.clerk_user_id)
    except ClerkUnavailableError as exc:
        msg = f"Clerk did not answer: {exc}"
        raise BillingCommandError(msg) from None
    if clerk_user is None or clerk_user.email is None:
        msg = f"Clerk has no email for {found.clerk_user_id}; nothing was sent"
        raise BillingCommandError(msg)
    message = warning_email(
        to=clerk_user.email,
        step=step,
        deletion_on=_deletion_on(found, step, now),
        last_active=found.active_since,
        recordings=found.recordings,
        scans=found.scans,
        web_origin=settings.web_origin,
    )
    try:
        await mailer.send(message, idempotency_key=f"inactivity-test/{uuid.uuid4()}")
    except MailerUnavailableError as exc:
        msg = f"not sent: {exc}"
        raise BillingCommandError(msg) from None
    return "sent: Resend accepted the message"


async def run_now(
    sessionmaker: async_sessionmaker[AsyncSession],
    mailer: Mailer,
    clerk_users: ClerkUsers,
    settings: Settings,
    now: datetime,
) -> str:
    """Take one pass at `now`, leaving the daily schedule alone.

    Returns:
        The line to print.
    """
    changed = await run_inactivity(sessionmaker, mailer, clerk_users, settings, now, clock=utc_now)
    return f"{changed} account{'' if changed == 1 else 's'} changed"


def require_clients(settings: Settings) -> None:
    """Refuse a command that sends mail when Resend or Clerk is not configured.

    Raises:
        BillingCommandError: A key is missing.
    """
    if not settings.mail_configured:
        msg = "CROSSTUNE_RESEND_API_KEY is not set: no mail can be sent"
        raise BillingCommandError(msg)
    if not settings.clerk_secret_key.get_secret_value():
        msg = "CROSSTUNE_CLERK_SECRET_KEY is not set: addresses cannot be read"
        raise BillingCommandError(msg)


def build_parser() -> argparse.ArgumentParser:
    """The `preview`, `send-test`, and `run` subcommands."""
    parser = argparse.ArgumentParser(prog="crosstune.ops.inactivity", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    preview_parser = commands.add_parser("preview", help="show an account's inactivity state")
    preview_parser.add_argument("account", help="Clerk user ID or email")

    send_parser = commands.add_parser("send-test", help="mail a warning to one account now")
    send_parser.add_argument("account", help="Clerk user ID or email")
    send_parser.add_argument("--notice", required=True, choices=sorted(_NOTICE_STEPS))

    commands.add_parser("run", help="take one pass now")

    for sub in (preview_parser, send_parser, commands.choices["run"]):
        sub.add_argument("--e2e", action="store_true", help="work on the e2e database")
    for sub in (send_parser, commands.choices["run"]):
        sub.add_argument("--yes", action="store_true", help="confirm working on production")
    return parser


async def run(settings: Settings, args: argparse.Namespace) -> None:
    """Check the target, run the command, and print its result."""
    # Preview writes nothing, so production needs no confirmation for it.
    previewing = args.command == "preview"
    check_target(settings, yes=previewing or args.yes, e2e=args.e2e)
    if not previewing:
        require_clients(settings)
    now = utc_now()
    engine = make_engine(settings.database_url)
    try:
        sessionmaker = make_sessionmaker(engine)
        if previewing:
            print("\n".join(await preview(sessionmaker, args.account, now)))
        else:
            await _send_or_run(sessionmaker, settings, args, now)
    finally:
        await engine.dispose()


async def _send_or_run(
    sessionmaker: async_sessionmaker[AsyncSession],
    settings: Settings,
    args: argparse.Namespace,
    now: datetime,
) -> None:
    """Run `send-test` or `run` with real Resend and Clerk clients, closing their connection."""
    http_client = public_only_client(settings.link_resolve_timeout_seconds)
    try:
        mailer = ResendMailer(
            http_client, settings.resend_api_key.get_secret_value(), settings.email_from
        )
        clerk = ClerkBackendUsers(http_client, settings.clerk_secret_key.get_secret_value())
        if args.command == "send-test":
            line = await send_test(
                sessionmaker, mailer, clerk, args.account, args.notice, settings, now
            )
        else:
            line = await run_now(sessionmaker, mailer, clerk, settings, now)
        print(line)
    finally:
        await http_client.aclose()


def main(argv: list[str] | None = None) -> int:
    """Run `preview`, `send-test`, or `run` from the command line."""
    args = build_parser().parse_args(argv)
    try:
        asyncio.run(run(load_settings(), args))
    except ValidationError as exc:
        problems = "; ".join(str(error["msg"]) for error in exc.errors())
        print(f"unusable settings: {problems}", file=sys.stderr)
        return 1
    except BillingCommandError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
