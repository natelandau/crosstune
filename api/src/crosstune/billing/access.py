"""Resolve what a user's grants allow and keep the synced entitlements row current."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import select

from crosstune.db.base import bump_server_seq, utc_now
from crosstune.models import Entitlement, Grant, Scan
from crosstune.vocabulary import GrantKind, GrantSource

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
    counts_recordings: bool


@dataclass(frozen=True)
class Resolution:
    """Access plus the facts the entitlements row reports to clients."""

    access: Access
    premium_source: GrantSource | None
    premium_expires_at: datetime | None
    auto_renews: bool
    trial_ends_at: datetime | None
    premium_quota_bytes: int
    free_quota_bytes: int


def _active(grant: Grant, now: datetime) -> bool:
    return grant.expires_at is None or grant.expires_at > now


def _lasts_longest(grant: Grant) -> tuple[int, float, int]:
    """Sort key where the largest value is the grant that holds Premium longest."""
    never_lapses = grant.expires_at is None
    expiry = 0.0 if grant.expires_at is None else grant.expires_at.timestamp()
    return (1 if never_lapses else 0, expiry, -_SOURCE_RANK[grant.source])


def resolve(grants: Sequence[Grant], now: datetime, settings: Settings) -> Resolution:
    """Resolve a user's grants into access and the entitlement fields.

    Args:
        grants: Every grant the user holds, active or not.
        now: The instant to judge expiry against.
        settings: Source of the quota sizes.

    Returns:
        The access the user has and the values the entitlements row stores.
    """
    premium = [g for g in grants if g.kind == GrantKind.PREMIUM and _active(g, now)]
    addon = any(g.kind == GrantKind.STORAGE_ADDON and _active(g, now) for g in grants)
    trial_ends_at = next(
        (
            g.expires_at
            for g in grants
            if g.kind == GrantKind.PREMIUM and g.source == GrantSource.TRIAL
        ),
        None,
    )

    if not premium:
        return Resolution(
            access=Access(
                premium=False, quota_bytes=settings.free_scan_quota_bytes, counts_recordings=False
            ),
            premium_source=None,
            premium_expires_at=None,
            auto_renews=False,
            trial_ends_at=trial_ends_at,
            premium_quota_bytes=settings.trial_quota_bytes,
            free_quota_bytes=settings.free_scan_quota_bytes,
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
        access=Access(premium=True, quota_bytes=premium_quota, counts_recordings=True),
        premium_source=GrantSource(reported.source),
        premium_expires_at=reported.expires_at,
        auto_renews=reported.auto_renews,
        trial_ends_at=trial_ends_at,
        premium_quota_bytes=premium_quota,
        free_quota_bytes=settings.free_scan_quota_bytes,
    )


async def _resolve_for(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime
) -> Resolution:
    grants = (await session.scalars(select(Grant).where(Grant.user_id == user_id))).all()
    return resolve(grants, now, settings)


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
        "trial_ends_at": resolution.trial_ends_at,
        "premium_quota_bytes": resolution.premium_quota_bytes,
        "free_quota_bytes": resolution.free_quota_bytes,
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


async def scan_tune_id(session: AsyncSession, user_id: uuid.UUID) -> uuid.UUID | None:
    """The tune holding the user's oldest live scan, the one tune free scans may use."""
    return await session.scalar(
        select(Scan.tune_id)
        .where(Scan.user_id == user_id, Scan.deleted_at.is_(None))
        .order_by(Scan.created_at, Scan.id)
        .limit(1)
    )
