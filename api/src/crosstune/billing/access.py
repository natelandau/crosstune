"""Resolve what a user's grants allow and keep the synced entitlements row current."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.models import Entitlement, Grant, User
from crosstune.vocabulary import WITHDRAWAL_WINDOW, GrantKind, GrantSource

if TYPE_CHECKING:
    import uuid
    from collections.abc import Sequence
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

# Lower ranks win a tie on expiry: a billing provider outranks a comp, a comp a trial.
_SOURCE_RANK: dict[str, int] = {
    GrantSource.APPLE: 0,
    GrantSource.STRIPE: 0,
    GrantSource.COMP: 1,
    GrantSource.TRIAL: 2,
}


@dataclass(frozen=True)
class Access:
    """What a plan allows right now."""

    premium: bool
    quota_bytes: int


@dataclass(frozen=True)
class PaidGrant:
    """One store's subscription as clients see it, so each judges its expiry as for the reported grant."""

    source: GrantSource
    expires_at: datetime | None
    auto_renews: bool

    def as_row(self) -> dict[str, object]:
        """The JSON the entitlements row stores and syncs."""
        return {
            "source": self.source.value,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "auto_renews": self.auto_renews,
        }


@dataclass(frozen=True)
class Resolution:
    """Access plus the facts the entitlements row reports to clients."""

    access: Access
    premium_source: GrantSource | None
    premium_expires_at: datetime | None
    auto_renews: bool
    trial_starts_at: datetime | None
    trial_ends_at: datetime | None
    premium_quota_bytes: int
    # Each store's longest active paid grant, which the reported grant alone can hide: an
    # open-ended comp outlasts a subscription that still bills.
    paid_grants: tuple[PaidGrant, ...] = ()
    withdraw_until: datetime | None = None
    withdrawal_used: bool = False


_PAID_SOURCES = (GrantSource.APPLE, GrantSource.STRIPE)


def _active(grant: Grant, now: datetime) -> bool:
    return grant.expires_at is None or grant.expires_at > now


def _lasts_longest(grant: Grant) -> tuple[int, float, int]:
    """Sort key where the largest value is the grant that holds Premium longest."""
    never_lapses = grant.expires_at is None
    expiry = 0.0 if grant.expires_at is None else grant.expires_at.timestamp()
    return (1 if never_lapses else 0, expiry, -_SOURCE_RANK[grant.source])


def live_stripe_grant(grants: Sequence[Grant], now: datetime) -> Grant | None:
    """The active web Premium grant with a known start, the one a withdrawal refunds.

    When several are active, the one that lasts longest, as `paid_grants` reports it.
    """
    return max(
        (
            g
            for g in grants
            if g.kind == GrantKind.PREMIUM
            and g.source == GrantSource.STRIPE
            and g.started_at is not None
            and _active(g, now)
        ),
        key=_lasts_longest,
        default=None,
    )


def withdrawal_window_open(grant: Grant, now: datetime) -> bool:
    """Whether `now` falls inside the withdrawal window of `grant`'s subscription."""
    return grant.started_at is not None and grant.started_at + WITHDRAWAL_WINDOW > now


def _withdraw_until(
    grants: Sequence[Grant], withdrew_at: datetime | None, now: datetime
) -> datetime | None:
    if withdrew_at is not None:
        return None
    grant = live_stripe_grant(grants, now)
    if grant is None or grant.started_at is None or not withdrawal_window_open(grant, now):
        return None
    return grant.started_at + WITHDRAWAL_WINDOW


def resolve(
    grants: Sequence[Grant],
    now: datetime,
    settings: Settings,
    *,
    withdrew_at: datetime | None = None,
) -> Resolution:
    """Resolve a user's grants into access and the entitlement fields.

    Args:
        grants: Every grant the user holds, active or not.
        now: The instant to judge expiry against.
        settings: Source of the quota sizes.
        withdrew_at: When the user withdrew from a web subscription, which they may do once.

    Returns:
        The access the user has and the values the entitlements row stores.
    """
    premium = [g for g in grants if g.kind == GrantKind.PREMIUM and _active(g, now)]
    addon = any(g.kind == GrantKind.STORAGE_ADDON and _active(g, now) for g in grants)
    trial = next(
        (g for g in grants if g.kind == GrantKind.PREMIUM and g.source == GrantSource.TRIAL),
        None,
    )
    # The grant's creation is the trial's start, so a moved end changes the trial's length.
    trial_starts_at = trial.created_at if trial else None
    trial_ends_at = trial.expires_at if trial else None

    if not premium:
        return Resolution(
            access=Access(premium=False, quota_bytes=0),
            premium_source=None,
            premium_expires_at=None,
            auto_renews=False,
            trial_starts_at=trial_starts_at,
            trial_ends_at=trial_ends_at,
            premium_quota_bytes=settings.trial_quota_bytes,
            withdrawal_used=withdrew_at is not None,
        )

    paid_grants = tuple(
        PaidGrant(GrantSource(longest.source), longest.expires_at, longest.auto_renews)
        for source in _PAID_SOURCES
        if (
            longest := max(
                (g for g in premium if g.source == source), key=_lasts_longest, default=None
            )
        )
    )
    reported = max(premium, key=_lasts_longest)
    # The quota follows the reported grant, so the row's quota and expiry describe one grant.
    if reported.source == GrantSource.TRIAL:
        premium_quota = settings.trial_quota_bytes
    else:
        premium_quota = settings.premium_quota_bytes + (
            settings.storage_addon_bytes if addon else 0
        )
    return Resolution(
        access=Access(premium=True, quota_bytes=premium_quota),
        premium_source=GrantSource(reported.source),
        premium_expires_at=reported.expires_at,
        auto_renews=reported.auto_renews,
        trial_starts_at=trial_starts_at,
        trial_ends_at=trial_ends_at,
        premium_quota_bytes=premium_quota,
        paid_grants=paid_grants,
        withdraw_until=_withdraw_until(grants, withdrew_at, now),
        withdrawal_used=withdrew_at is not None,
    )


async def _resolve_for(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime
) -> Resolution:
    grants = (await session.scalars(select(Grant).where(Grant.user_id == user_id))).all()
    withdrew_at = await session.scalar(select(User.withdrew_at).where(User.id == user_id))
    return resolve(grants, now, settings, withdrew_at=withdrew_at)


async def access_for(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime | None = None
) -> Access:
    """Resolve the user's current access from their grants."""
    return (await _resolve_for(session, user_id, settings, now or utc_now())).access


async def refresh_entitlement(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime | None = None
) -> Entitlement:
    """Bring the user's entitlements row in line with their grants.

    Creates the row when missing. An existing row changes, and takes a new
    server_seq, only when a resolved field differs, so devices pull nothing
    when nothing changed.
    """
    now = now or utc_now()
    resolution = await _resolve_for(session, user_id, settings, now)
    values = {
        "premium_source": resolution.premium_source.value if resolution.premium_source else None,
        "premium_expires_at": resolution.premium_expires_at,
        "auto_renews": resolution.auto_renews,
        "trial_starts_at": resolution.trial_starts_at,
        "trial_ends_at": resolution.trial_ends_at,
        "premium_quota_bytes": resolution.premium_quota_bytes,
        "paid_grants": [grant.as_row() for grant in resolution.paid_grants],
        "withdraw_until": resolution.withdraw_until,
        "withdrawal_used": resolution.withdrawal_used,
    }

    row = await session.scalar(select(Entitlement).where(Entitlement.user_id == user_id))
    if row is None:
        row = Entitlement(user_id=user_id, created_at=now, updated_at=now, **values)
        session.add(row)
    elif any(getattr(row, name) != value for name, value in values.items()):
        for name, value in values.items():
            setattr(row, name, value)
        row.updated_at = now
        bump_server_seq(row)
    else:
        return row
    await session.flush()
    # Loads the server_seq the database assigned, so the row serializes without lazy loads.
    await session.refresh(row)
    return row
