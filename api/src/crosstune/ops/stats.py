"""Operator command that counts accounts by country, and withdrawals still to cancel.

Run as `just api::stats countries`. It only reads, so production needs no `--yes`, but it
still prints the environment and database it reads from.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from datetime import timedelta
from typing import TYPE_CHECKING

from pydantic import ValidationError
from sqlalchemy import case, func, or_, select

from crosstune.billing.withdrawal import PENDING
from crosstune.db.base import utc_now
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.models import Entitlement, Grant, User
from crosstune.ops.billing import BillingCommandError, check_target, load_settings
from crosstune.vocabulary import CONSENT_COUNTRIES

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

_UNKNOWN = "unknown"
_EU_LABEL = "EU and EEA"
_ALL_LABEL = "All"


@dataclass(frozen=True, slots=True)
class CountryRow:
    """Account counts for one country; `country` is None where it was never recorded."""

    country: str | None
    accounts: int
    active_7: int
    active_n: int
    premium: int


async def country_counts(
    session: AsyncSession, now: datetime, active_days: int
) -> list[CountryRow]:
    """Count accounts, recent syncs, and premium accounts per country.

    Premium means the entitlement names a source that has not expired at `now`.

    Returns:
        One row per country, most accounts first, with the unknown country last.
    """
    week_ago = now - timedelta(days=7)
    window_start = now - timedelta(days=active_days)
    premium = (Entitlement.premium_source.is_not(None)) & or_(
        Entitlement.premium_expires_at.is_(None), Entitlement.premium_expires_at > now
    )
    stmt = (
        select(
            User.country,
            func.count(User.id),
            func.count(case((User.last_synced_at >= week_ago, 1))),
            func.count(case((User.last_synced_at >= window_start, 1))),
            func.count(case((premium, 1))),
        )
        .outerjoin(Entitlement, Entitlement.user_id == User.id)
        .group_by(User.country)
    )
    rows = [CountryRow(*row) for row in (await session.execute(stmt)).all()]
    return sorted(rows, key=lambda r: (r.country is None, -r.accounts, r.country or ""))


async def refunded_not_cancelled(session: AsyncSession) -> int:
    """Count withdrawals whose refund went through but whose subscription is not yet cancelled."""
    return await session.scalar(select(func.count(Grant.id)).where(*PENDING)) or 0


def _total(label: str, rows: list[CountryRow]) -> CountryRow:
    return CountryRow(
        label,
        sum(r.accounts for r in rows),
        sum(r.active_7 for r in rows),
        sum(r.active_n for r in rows),
        sum(r.premium for r in rows),
    )


def format_table(rows: list[CountryRow], active_days: int) -> str:
    """The rows as a fixed-width table, then the EU and EEA total and the grand total."""
    eu = _total(_EU_LABEL, [r for r in rows if r.country in CONSENT_COUNTRIES])
    header = ("country", "accounts", "active 7d", f"active {active_days}d", "premium")
    body = [
        (r.country or _UNKNOWN, *map(str, _numbers(r)))
        for r in [*rows, eu, _total(_ALL_LABEL, rows)]
    ]
    lines: list[tuple[str, ...]] = [header, *body]
    widths = [max(len(line[i]) for line in lines) for i in range(5)]
    return "\n".join(
        line[0].ljust(widths[0])
        + "  "
        + "  ".join(c.rjust(w) for c, w in zip(line[1:], widths[1:], strict=True))
        for line in lines
    )


def _numbers(row: CountryRow) -> tuple[int, int, int, int]:
    return row.accounts, row.active_7, row.active_n, row.premium


def build_parser() -> argparse.ArgumentParser:
    """The `countries` subcommand."""
    parser = argparse.ArgumentParser(prog="crosstune.ops.stats", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    countries = commands.add_parser("countries", help="count accounts by country")
    countries.add_argument(
        "--active-days", type=int, default=30, help="window for recent syncs (default 30)"
    )
    countries.add_argument("--e2e", action="store_true", help="read the e2e database")
    return parser


async def run(settings: Settings, args: argparse.Namespace) -> None:
    """Check the target, count, and print the table and the withdrawals still to cancel."""
    check_target(settings, yes=True, e2e=args.e2e)
    engine = make_engine(settings.database_url)
    try:
        async with make_sessionmaker(engine)() as session:
            rows = await country_counts(session, utc_now(), args.active_days)
            pending = await refunded_not_cancelled(session)
        print(format_table(rows, args.active_days))
        print(f"Withdrawals refunded but not cancelled: {pending}")
    finally:
        await engine.dispose()


def main(argv: list[str] | None = None) -> int:
    """Run `countries` from the command line."""
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
