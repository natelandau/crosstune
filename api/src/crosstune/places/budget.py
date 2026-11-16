"""Daily budgets on the operator's Apple Maps quota, per account and for the whole team.

Apple's free quota is per day and shared by every user, so each use is charged here before
the call is made or the token or URL is issued. The counts live in Postgres, so they outlast
a sleeping or restarted process, which the per-minute limiters do not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from enum import Enum, auto
from typing import TYPE_CHECKING

from sqlalchemy import delete, text

from crosstune.models import MapsUsage
from crosstune.reportable import reportable
from crosstune.vocabulary import MapsUsageKind

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

# How many past days of counts the sweep keeps, so recent use can still be read.
KEPT_DAYS = 7


class SpentBy(Enum):
    """Which budget refused a charge."""

    ACCOUNT = auto()
    TEAM = auto()


@reportable
@dataclass(frozen=True, slots=True)
class DailyLimits:
    """How many uses of one kind one account, and the whole team, may make in a UTC day."""

    per_account: int
    team: int


@reportable
@dataclass(frozen=True, slots=True)
class BudgetSpent:
    """A refused charge: whose budget is spent, and when the next day's budget opens."""

    by: SpentBy
    resets_at: datetime

    def retry_after_seconds(self, now: datetime) -> float:
        """Seconds from `now` until the budget resets."""
        return max(0.0, (self.resets_at - now).total_seconds())


def daily_limits(settings: Settings, *, kind: MapsUsageKind) -> DailyLimits:
    """Read the configured per-account and team limits for one kind of use.

    Returns:
        DailyLimits: The limits that `charge` checks for `kind`.
    """
    match kind:
        case MapsUsageKind.SERVICE_CALL:
            return DailyLimits(
                per_account=settings.place_service_calls_per_user_per_day,
                team=settings.place_service_calls_per_day,
            )
        case MapsUsageKind.MAPKIT_TOKEN:
            return DailyLimits(
                per_account=settings.mapkit_tokens_per_user_per_day,
                team=settings.mapkit_tokens_per_day,
            )
        case MapsUsageKind.SNAPSHOT:
            return DailyLimits(
                per_account=settings.place_snapshots_per_user_per_day,
                team=settings.place_snapshots_per_day,
            )


def next_day_start(now: datetime) -> datetime:
    """The UTC midnight after `now`, when every daily budget opens again."""
    today = now.astimezone(UTC).date()
    return datetime.combine(today + timedelta(days=1), time.min, tzinfo=UTC)


# Each scope has its own partial unique index, since a null user_id never conflicts. The team
# row is taken only when the account row was.
_CHARGE_ACCOUNT_AND_TEAM = text("""
    with account as (
        insert into maps_usage (user_id, kind, day, count)
        values (cast(:user_id as uuid), cast(:kind as varchar), cast(:day as date), 1)
        on conflict (user_id, kind, day) where user_id is not null
        do update set count = maps_usage.count + 1 where maps_usage.count < :account_limit
        returning 1
    ), team as (
        insert into maps_usage (user_id, kind, day, count)
        select null, cast(:kind as varchar), cast(:day as date), 1
        where exists (select from account)
        on conflict (kind, day) where user_id is null
        do update set count = maps_usage.count + 1 where maps_usage.count < :team_limit
        returning 1
    )
    select exists (select from account), exists (select from team)
""")
_CHARGE_TEAM = text("""
    with team as (
        insert into maps_usage (user_id, kind, day, count)
        values (null, cast(:kind as varchar), cast(:day as date), 1)
        on conflict (kind, day) where user_id is null
        do update set count = maps_usage.count + 1 where maps_usage.count < :team_limit
        returning 1
    )
    select true, exists (select from team)
""")


async def charge(
    session: AsyncSession,
    *,
    user_id: uuid.UUID | None,
    kind: MapsUsageKind,
    limits: DailyLimits,
    now: datetime,
) -> BudgetSpent | None:
    """Count one use against the account's and the team's budgets, refusing it when either is spent.

    One statement increments and checks both rows, each in an upsert that holds the row's
    lock until the caller commits, so concurrent charges never pass a limit. The account row
    is locked before the team row, so two charges never wait on each other in a cycle. A use
    the team refuses still counts against its account, which changes nothing: the team stays
    spent, for every account, until the day ends. With no `user_id`, only the team is charged,
    for work no account asked for.

    Returns:
        BudgetSpent | None: None when the use is counted, else which budget is spent.
    """
    params = {
        "user_id": user_id,
        "kind": kind.value,
        "day": now.astimezone(UTC).date(),
        "account_limit": limits.per_account,
        "team_limit": limits.team,
    }
    statement = _CHARGE_TEAM if user_id is None else _CHARGE_ACCOUNT_AND_TEAM
    account_taken, team_taken = (await session.execute(statement, params)).one()
    if account_taken and team_taken:
        return None
    by = SpentBy.ACCOUNT if not account_taken else SpentBy.TEAM
    return BudgetSpent(by=by, resets_at=next_day_start(now))


async def prune(session: AsyncSession, *, now: datetime) -> None:
    """Delete the counts of days older than KEPT_DAYS."""
    oldest = now.astimezone(UTC).date() - timedelta(days=KEPT_DAYS)
    await session.execute(delete(MapsUsage).where(MapsUsage.day < oldest))
