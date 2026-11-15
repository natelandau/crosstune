"""Operator command that emails every account about a significant change to the terms or privacy policy.

Run as `just ops::notify-accounts --subject S --key K --body PATH|-`. The body is plain
prose: blank lines separate paragraphs and bare https URLs become links. Without `--yes` it
only prints how many accounts it would email, in every environment. With `--yes` it sends in
batches of 100 and records each account it emailed under `--key`, so a rerun, after a Resend
rate limit or any other stop, emails only the accounts it missed. A batch Resend refuses is
sent one email at a time, so an address Resend will not take holds back only itself.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import re
import sys
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING

from pydantic import ValidationError
from sqlalchemy import exists, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.exc import SQLAlchemyError

from crosstune.billing.clients import make_mailer
from crosstune.db.base import utc_now
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.db.locks import release_notice_lock, try_notice_lock
from crosstune.email.layout import html_body
from crosstune.email.resend import (
    MAX_BATCH_SIZE,
    EmailMessage,
    MailerRateLimitedError,
    MailerUnavailableError,
)
from crosstune.http import public_only_client
from crosstune.models import AccountNotice, User
from crosstune.ops.billing import BillingCommandError, check_target, load_settings, settings_error

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from crosstune.email.resend import Mailer

KEY_MAX_LENGTH = 100
_PARAGRAPH_BREAK = re.compile(r"\n\s*\n")
_URL = re.compile(r"https://[^\s<>\"]+")
_URL_TRAILING_PUNCTUATION = ".,;:!?)"


def _key(value: str) -> str:
    if not value or len(value) > KEY_MAX_LENGTH:
        msg = f"must be 1 to {KEY_MAX_LENGTH} characters"
        raise argparse.ArgumentTypeError(msg)
    return value


def read_body(source: str) -> str:
    """The email body from a file path, or from standard input when `source` is `-`."""
    if source == "-":
        return sys.stdin.read()
    with open(source, encoding="utf-8") as handle:  # noqa: PTH123 -- a plain read of an operator-named path
        return handle.read()


def build_message(to: str, subject: str, body: str) -> EmailMessage:
    """Build the email: paragraphs as plain text, and as HTML with each https URL linked.

    Raises:
        BillingCommandError: The body has no text.
    """
    paragraphs = [part.strip() for part in _PARAGRAPH_BREAK.split(body.strip()) if part.strip()]
    if not paragraphs:
        msg = "the email body is empty"
        raise BillingCommandError(msg)
    links = [
        match.rstrip(_URL_TRAILING_PUNCTUATION)
        for paragraph in paragraphs
        for match in _URL.findall(paragraph)
    ]
    return EmailMessage(
        to=to,
        subject=subject,
        text="\n\n".join(paragraphs),
        html=html_body(paragraphs, links),
    )


async def _unnoticed_users(session: AsyncSession, key: str) -> list[tuple[uuid.UUID, str]]:
    """Every account with an email that has no notice under `key`, in a stable order."""
    already = exists().where(AccountNotice.user_id == User.id, AccountNotice.notice_key == key)
    rows = await session.execute(
        select(User.id, User.email).where(User.email.is_not(None), ~already).order_by(User.id)
    )
    return [(user_id, email) for user_id, email in rows.all() if email]


def _batch_key(key: str, batch: list[tuple[uuid.UUID, str]]) -> str:
    # Resend refuses a reused key whose payload differs, so the key names the exact members.
    members = hashlib.sha256(",".join(str(user_id) for user_id, _ in batch).encode())
    return f"{key}:batch:{members.hexdigest()[:32]}"


async def _record(session: AsyncSession, key: str, user_ids: list[uuid.UUID]) -> None:
    if not user_ids:
        return
    now = utc_now()
    await session.execute(
        insert(AccountNotice)
        .values([{"user_id": user_id, "notice_key": key, "sent_at": now} for user_id in user_ids])
        .on_conflict_do_nothing()
    )
    await session.commit()


@dataclass
class _SingleSends:
    sent: int = 0
    refused: list[tuple[uuid.UUID, str, str]] = field(default_factory=list)
    rate_limited: bool = False


async def _send_one_by_one(
    session: AsyncSession,
    mailer: Mailer,
    key: str,
    batch: list[tuple[uuid.UUID, str]],
    template: EmailMessage,
) -> _SingleSends:
    """Send a refused batch one email at a time, recording each account Resend accepts."""
    outcome = _SingleSends()
    accepted: list[uuid.UUID] = []
    try:
        for user_id, email in batch:
            try:
                await mailer.send(replace(template, to=email), idempotency_key=f"{key}:{user_id}")
            except MailerRateLimitedError:
                outcome.rate_limited = True
                break
            except MailerUnavailableError as exc:
                outcome.refused.append((user_id, email, str(exc)))
            else:
                accepted.append(user_id)
    finally:
        await _record(session, key, accepted)
    outcome.sent = len(accepted)
    return outcome


async def execute(
    session: AsyncSession, mailer: Mailer | None, args: argparse.Namespace, body: str
) -> int:
    """Count the accounts due the email, and with `--yes` send it to them in batches.

    Each batch's notices commit right after Resend accepts it, so a stop never forgets
    what was sent or marks what was not. A refused batch is sent one email at a time, and
    the run continues past the addresses Resend refuses unless it refuses every one.

    Returns:
        The exit code: 0 when every account was emailed or a dry run, 1 when Resend
        stopped the run or refused an address.

    Raises:
        BillingCommandError: The body is empty, or `--yes` was given without mail configured.
    """
    template = build_message("", args.subject, body)
    pending = await _unnoticed_users(session, args.key)
    if not args.yes:
        print(f"would email {len(pending)} accounts; pass --yes to send")
        return 0
    if not pending:
        print("no accounts to email")
        return 0
    if mailer is None:
        msg = "cannot send: mail is not configured"
        raise BillingCommandError(msg)
    sent = 0
    refused: list[tuple[uuid.UUID, str, str]] = []
    for start in range(0, len(pending), MAX_BATCH_SIZE):
        batch = pending[start : start + MAX_BATCH_SIZE]
        messages = [replace(template, to=email) for _, email in batch]
        try:
            await mailer.send_batch(messages, idempotency_key=_batch_key(args.key, batch))
        except MailerRateLimitedError:
            return _stop_for_rate_limit(refused, sent, len(pending) - sent)
        except MailerUnavailableError as exc:
            outcome = await _send_one_by_one(session, mailer, args.key, batch, template)
            sent += outcome.sent
            if not outcome.sent and not outcome.rate_limited:
                # Resend refusing every address on its own too is an outage, not bad addresses.
                _print_refused(refused)
                ids = ", ".join(str(user_id) for user_id, _ in batch)
                print(f"sent {sent}, {len(pending) - sent} remain; Resend refused a batch: {exc}")
                print(f"the refused batch was for accounts {ids}")
                return 1
            refused.extend(outcome.refused)
            if outcome.rate_limited:
                return _stop_for_rate_limit(refused, sent, len(pending) - sent)
            continue
        await _record(session, args.key, [user_id for user_id, _ in batch])
        sent += len(batch)
    _print_refused(refused)
    print(f"sent {sent} emails")
    return 1 if refused else 0


def _print_refused(refused: list[tuple[uuid.UUID, str, str]]) -> None:
    for user_id, email, reason in refused:
        print(f"Resend refused {email} (account {user_id}): {reason}")


def _stop_for_rate_limit(refused: list[tuple[uuid.UUID, str, str]], sent: int, remain: int) -> int:
    _print_refused(refused)
    print(f"sent {sent}, {remain} remain; run again later or move Resend to Pro")
    return 1


def build_parser() -> argparse.ArgumentParser:
    """The command's arguments."""
    parser = argparse.ArgumentParser(prog="crosstune.ops.notify_accounts", description=__doc__)
    parser.add_argument("--subject", required=True, help="the email's subject line")
    parser.add_argument(
        "--key",
        required=True,
        type=_key,
        help="names this announcement, such as terms-2027-04; an account is emailed once per key",
    )
    parser.add_argument("--body", required=True, help="path to the email body, or - for stdin")
    parser.add_argument("--yes", action="store_true", help="send; without it, only count")
    parser.add_argument("--e2e", action="store_true", help="use the e2e database")
    return parser


async def run(settings: Settings, args: argparse.Namespace) -> int:
    """Check the target, read the body, and run `execute` on its own session."""
    # The dry run is the default everywhere, so production needs no separate `--yes` gate.
    check_target(settings, yes=True, e2e=args.e2e)
    body = read_body(args.body)
    engine = make_engine(settings)
    http_client = public_only_client(settings.link_resolve_timeout_seconds)
    try:
        if not args.yes:
            async with make_sessionmaker(engine)() as session:
                return await execute(session, None, args, body)
        # A session lock lives on one connection, while the run commits between batches, so
        # it takes a connection of its own.
        async with engine.connect() as lock_connection:
            if not await try_notice_lock(lock_connection, args.key):
                print(f"another run is sending {args.key}; wait for it to finish", file=sys.stderr)
                return 1
            try:
                mailer = make_mailer(http_client, settings)
                async with make_sessionmaker(engine)() as session:
                    return await execute(session, mailer, args, body)
            finally:
                try:
                    await release_notice_lock(lock_connection, args.key)
                except SQLAlchemyError as exc:
                    # The lock ends with its connection anyway, so the run's own outcome is kept.
                    print(
                        f"could not release the lock on {args.key}: {exc.__class__.__name__}",
                        file=sys.stderr,
                    )
    finally:
        await http_client.aclose()
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Run the command from the command line."""
    args = build_parser().parse_args(argv)
    try:
        return asyncio.run(run(load_settings(), args))
    except ValidationError as exc:
        print(settings_error(exc), file=sys.stderr)
        return 1
    except (BillingCommandError, OSError) as exc:
        print(exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
