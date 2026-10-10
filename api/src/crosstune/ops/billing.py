"""Operator commands that comp an account or move its trial end.

Run as `just api::comp` and `just api::trial`. Each prints the environment and database
it will write to, refuses production without `--yes`, and refuses the e2e database.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import re
import sys
from datetime import UTC, date, datetime, timedelta
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from pydantic import ValidationError
from sqlalchemy import delete, func, or_, select
from sqlalchemy.dialects.postgresql import insert

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import grant_comp, revoke_comp, set_trial_end
from crosstune.config import Settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.db.locks import lock_user
from crosstune.models import Grant, PendingComp, User
from crosstune.models.user import utc_now
from crosstune.vocabulary import GrantKind, GrantSource

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

_DURATION = re.compile(r"(\d+)([dhm])", re.IGNORECASE)
_UNITS = {"d": "days", "h": "hours", "m": "minutes"}


class BillingCommandError(Exception):
    """The command's target or arguments are unusable; the message says what to fix."""


def parse_when(text: str, now: datetime) -> datetime:
    """Read an ISO date or datetime, or a duration from `now` such as `2d`, `12h`, `30m`.

    A date without a time means the start of that day, and a time without an offset is UTC.

    Raises:
        BillingCommandError: The text is neither.
    """
    if match := _DURATION.fullmatch(text):
        return now + timedelta(**{_UNITS[match[2].lower()]: int(match[1])})
    try:
        parsed = (
            datetime.fromisoformat(text)
            if "T" in text or " " in text
            else datetime.combine(date.fromisoformat(text), datetime.min.time())
        )
    except ValueError:
        msg = f"cannot read {text!r}: use an ISO date or datetime, or a duration like 2d, 12h, 30m"
        raise BillingCommandError(msg) from None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def load_settings() -> Settings:
    """Build settings, reading `api/.env` only for local work.

    A host's variables stand alone: the local file's local-only keys would make
    hosted settings refuse to load, and its other keys would fill in what the host left unset.
    """
    if os.environ.get("CROSSTUNE_ENVIRONMENT", "development") != "development":
        return Settings(_env_file=None)
    return Settings()


def check_target(settings: Settings, *, yes: bool) -> None:
    """Print where the command will write, and refuse the e2e database and unconfirmed production.

    Raises:
        BillingCommandError: The database is the e2e one, or the environment is
            production and `--yes` was not given.
    """
    host = urlsplit(settings.database_url).hostname
    print(f"environment {settings.environment}, database {settings.database_name} on {host}")
    if settings.e2e_database:
        msg = f"refusing {settings.database_name}: the e2e suite owns and resets it"
        raise BillingCommandError(msg)
    if settings.environment == "production" and not yes:
        msg = "this is production: pass --yes to write"
        raise BillingCommandError(msg)


async def _find_user(session: AsyncSession, account: str) -> User | None:
    if "@" in account:
        stmt = select(User).where(func.lower(User.email) == account.lower())
    elif account.startswith("user_"):
        stmt = select(User).where(User.clerk_user_id == account)
    else:
        msg = f"{account!r} is neither a Clerk user ID (user_...) nor an email"
        raise BillingCommandError(msg)
    users = list((await session.scalars(stmt)).all())
    if len(users) > 1:
        ids = ", ".join(sorted(user.clerk_user_id for user in users))
        msg = f"{account} matches more than one account: {ids}"
        raise BillingCommandError(msg)
    return users[0] if users else None


async def _other_premium(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
    """Whether a Premium grant other than the trial is active."""
    found = await session.scalar(
        select(Grant.id)
        .where(
            Grant.user_id == user_id,
            Grant.kind == GrantKind.PREMIUM.value,
            Grant.source != GrantSource.TRIAL.value,
            or_(Grant.expires_at.is_(None), Grant.expires_at > now),
        )
        .limit(1)
    )
    return found is not None


async def comp(session: AsyncSession, settings: Settings, args: argparse.Namespace) -> str:
    """Grant, replace, or revoke a comp, or the pending comp promised to an email.

    Returns:
        The line to print.

    Raises:
        BillingCommandError: The account is unknown, or the arguments do not fit.
    """
    now = utc_now()
    expires_at = parse_when(args.until, now) if args.until else None
    if expires_at is not None and expires_at <= now:
        msg = f"--until {args.until} is in the past: use --revoke to end a comp"
        raise BillingCommandError(msg)
    user = await _find_user(session, args.account)
    if user is None:
        if "@" not in args.account:
            msg = f"no account has Clerk user ID {args.account}"
            raise BillingCommandError(msg)
        return await _pending_comp(session, args, expires_at)

    await lock_user(session, user.id)
    if args.revoke:
        revoked = await revoke_comp(session, user.id, now)
        await refresh_entitlement(session, user.id, settings, now)
        return "comp revoked" if revoked else "no active comp to revoke"
    await grant_comp(
        session,
        user.id,
        expires_at=expires_at,
        storage_addon=args.addon,
        granted_by=args.by,
        reason=args.reason,
        now=now,
    )
    await refresh_entitlement(session, user.id, settings, now)
    end = expires_at.isoformat() if expires_at else "further notice"
    return f"comped {user.clerk_user_id} until {end}" + (
        " with storage add-on" if args.addon else ""
    )


async def _pending_comp(
    session: AsyncSession, args: argparse.Namespace, expires_at: datetime | None
) -> str:
    email = args.account.lower()
    if args.revoke:
        deleted = await session.scalar(
            delete(PendingComp).where(PendingComp.email == email).returning(PendingComp.id)
        )
        return "pending comp deleted" if deleted else "no pending comp to delete"
    values = {
        "expires_at": expires_at,
        "storage_addon": args.addon,
        "granted_by": args.by,
        "reason": args.reason,
    }
    stmt = insert(PendingComp).values(email=email, **values)
    await session.execute(
        stmt.on_conflict_do_update(index_elements=[PendingComp.email], set_=values)
    )
    return (
        f"no account has the email {email}. Saved a pending comp, which applies only if an "
        "account signs up with this address. To comp an existing account, such as one whose "
        "email changed and has not signed in since, use its Clerk user ID"
    )


async def trial(session: AsyncSession, settings: Settings, args: argparse.Namespace) -> str:
    """Move the end of an account's trial.

    Returns:
        The line to print.

    Raises:
        BillingCommandError: The account is unknown or has no trial.
    """
    now = utc_now()
    user = await _find_user(session, args.account)
    if user is None:
        msg = f"no account matches {args.account}"
        raise BillingCommandError(msg)
    ends_at = now if args.ended else parse_when(args.ends, now)
    await lock_user(session, user.id)
    if ends_at > now and await _other_premium(session, user.id, now):
        msg = (
            f"{user.clerk_user_id} holds Premium from another grant, which a running trial "
            "would outrank: revoke that grant first, or use --ended"
        )
        raise BillingCommandError(msg)
    try:
        await set_trial_end(session, user.id, ends_at)
    except LookupError as exc:
        raise BillingCommandError(str(exc)) from None
    await refresh_entitlement(session, user.id, settings, now)
    return f"trial of {user.clerk_user_id} ends {ends_at.isoformat()}"


def build_parser() -> argparse.ArgumentParser:
    """The `comp` and `trial` subcommands."""
    parser = argparse.ArgumentParser(prog="crosstune.ops.billing", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    comp_parser = commands.add_parser("comp", help="comp an account, or revoke its comp")
    comp_parser.add_argument("account", help="Clerk user ID or email")
    comp_parser.add_argument("--until", help="end of the comp; omit for open-ended")
    comp_parser.add_argument("--addon", action="store_true", help="include the storage add-on")
    comp_parser.add_argument("--revoke", action="store_true", help="end the comp")
    comp_parser.add_argument("--reason", help="why; required unless revoking")
    comp_parser.add_argument("--by", default=None, help="who grants it; defaults to the login")

    trial_parser = commands.add_parser("trial", help="move the end of an account's trial")
    trial_parser.add_argument("account", help="Clerk user ID or email")
    when = trial_parser.add_mutually_exclusive_group(required=True)
    when.add_argument("--ends", help="ISO date or datetime, or a duration like 2d, 12h, 30m")
    when.add_argument("--ended", action="store_true", help="end the trial now")

    for sub in (comp_parser, trial_parser):
        sub.add_argument("--yes", action="store_true", help="confirm writing to production")
    return parser


async def run(settings: Settings, args: argparse.Namespace) -> None:
    """Check the target, run the command in one transaction, and print its result."""
    check_target(settings, yes=args.yes)
    command = comp if args.command == "comp" else trial
    engine = make_engine(settings.database_url)
    try:
        sessionmaker = make_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            print(await command(session, settings, args))
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Run `comp` or `trial` from the command line."""
    parser = build_parser()
    args = parser.parse_args(argv)
    if args.command == "comp":
        if args.revoke and (args.until or args.addon):
            parser.error("--revoke takes neither --until nor --addon")
        if not args.revoke and not args.reason:
            parser.error("--reason is required unless --revoke")
        args.by = args.by or getpass.getuser()
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
