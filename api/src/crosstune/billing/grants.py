"""Create and change grants: the trials and comps the server issues, and mirrored paid ones.

Each mutating function leaves calling `refresh_entitlement` to its caller.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import delete, func, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert

from crosstune.models import Grant, PendingComp
from crosstune.vocabulary import GrantEnvironment, GrantKind, GrantSource

if TYPE_CHECKING:
    import uuid
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

# Mirrors the partial unique index on grants, so an upsert can target it.
_SERVER_SOURCES = text("source in ('trial', 'comp')")
_PAID_SOURCES = text("source in ('apple', 'stripe')")


@dataclass(frozen=True)
class PaidSubscription:
    """One billing-provider subscription, as the provider reports it."""

    store_id: str
    source: GrantSource
    kind: GrantKind
    environment: GrantEnvironment
    expires_at: datetime | None
    auto_renews: bool


async def _upsert_server_grant(
    session: AsyncSession,
    user_id: uuid.UUID,
    kind: GrantKind,
    source: GrantSource,
    *,
    expires_at: datetime | None,
    audit: Mapping[str, str | None] | None = None,
    keep_existing: bool = False,
) -> Grant:
    audit = audit or {"granted_by": None, "reason": None}
    stmt = insert(Grant).values(
        user_id=user_id, kind=kind.value, source=source.value, expires_at=expires_at, **audit
    )
    target = [Grant.user_id, Grant.kind, Grant.source]
    if keep_existing:
        stmt = stmt.on_conflict_do_nothing(index_elements=target, index_where=_SERVER_SOURCES)
    else:
        stmt = stmt.on_conflict_do_update(
            index_elements=target,
            index_where=_SERVER_SOURCES,
            set_={
                "expires_at": expires_at,
                **audit,
                "updated_at": func.now(),
            },
        )
    await session.execute(stmt)
    return (
        await session.execute(
            select(Grant)
            .where(Grant.user_id == user_id, Grant.kind == kind.value, Grant.source == source.value)
            .execution_options(populate_existing=True)
        )
    ).scalar_one()


async def start_trial(
    session: AsyncSession, user_id: uuid.UUID, settings: Settings, now: datetime
) -> Grant:
    """Give the user their one trial; an existing trial is left as it is."""
    return await _upsert_server_grant(
        session,
        user_id,
        GrantKind.PREMIUM,
        GrantSource.TRIAL,
        expires_at=now + timedelta(days=settings.trial_days),
        keep_existing=True,
    )


async def end_trial(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """End the user's running trial now."""
    await session.execute(
        update(Grant)
        .where(
            Grant.user_id == user_id,
            Grant.source == GrantSource.TRIAL.value,
            Grant.expires_at > now,
        )
        .values(expires_at=now, updated_at=now)
    )


async def mirror_paid_grants(
    session: AsyncSession,
    user_id: uuid.UUID,
    subscriptions: list[PaidSubscription],
    now: datetime,
) -> set[uuid.UUID]:
    """Make the user's Apple and Stripe grants match the provider's subscriptions.

    A subscription held by another account moves to this user. A grant whose
    subscription is gone ends now. An active paid Premium grant ends a running trial.

    Returns:
        The other accounts a subscription moved from, whose entitlements are now stale.
    """
    moved_from: set[uuid.UUID] = set()
    if subscriptions:
        moved_from = set(
            (
                await session.scalars(
                    select(Grant.user_id).where(
                        tuple_(Grant.source, Grant.external_id).in_(
                            [(sub.source.value, sub.store_id) for sub in subscriptions]
                        ),
                        Grant.user_id != user_id,
                    )
                )
            ).all()
        )
    for sub in subscriptions:
        values = {
            "user_id": user_id,
            "kind": sub.kind.value,
            "environment": sub.environment.value,
            "expires_at": sub.expires_at,
            "auto_renews": sub.auto_renews,
        }
        await session.execute(
            insert(Grant)
            .values(source=sub.source.value, external_id=sub.store_id, **values)
            .on_conflict_do_update(
                index_elements=[Grant.source, Grant.external_id],
                index_where=_PAID_SOURCES,
                set_={**values, "updated_at": now},
            )
        )
    await session.execute(
        update(Grant)
        .where(
            Grant.user_id == user_id,
            Grant.source.in_([GrantSource.APPLE.value, GrantSource.STRIPE.value]),
            Grant.external_id.not_in([sub.store_id for sub in subscriptions]),
            (Grant.expires_at.is_(None)) | (Grant.expires_at > now),
        )
        .values(expires_at=now, auto_renews=False, updated_at=now)
    )
    if any(
        sub.kind == GrantKind.PREMIUM and (sub.expires_at is None or sub.expires_at > now)
        for sub in subscriptions
    ):
        await end_trial(session, user_id, now)
    return moved_from


async def grant_comp(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    expires_at: datetime | None,
    storage_addon: bool,
    granted_by: str,
    reason: str,
    now: datetime,
) -> Grant:
    """Upsert the user's comp Premium grant and make the comp add-on match `storage_addon`.

    Ends any running trial, since the rest of it is not added on. Revoking the comp
    later does not bring the trial back.

    Returns:
        The comp Premium grant.
    """
    audit = {"granted_by": granted_by, "reason": reason}
    await end_trial(session, user_id, now)
    grant = await _upsert_server_grant(
        session, user_id, GrantKind.PREMIUM, GrantSource.COMP, expires_at=expires_at, audit=audit
    )
    if storage_addon:
        await _upsert_server_grant(
            session,
            user_id,
            GrantKind.STORAGE_ADDON,
            GrantSource.COMP,
            expires_at=expires_at,
            audit=audit,
        )
    else:
        await _expire_comps(session, user_id, now, kind=GrantKind.STORAGE_ADDON)
    return grant


async def _expire_comps(
    session: AsyncSession, user_id: uuid.UUID, now: datetime, *, kind: GrantKind | None = None
) -> bool:
    stmt = (
        update(Grant)
        .where(
            Grant.user_id == user_id,
            Grant.source == GrantSource.COMP.value,
            (Grant.expires_at.is_(None)) | (Grant.expires_at > now),
        )
        .values(expires_at=now, updated_at=now)
        .returning(Grant.id)
    )
    if kind is not None:
        stmt = stmt.where(Grant.kind == kind.value)
    return (await session.scalars(stmt)).first() is not None


async def revoke_comp(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> bool:
    """End the user's comp grants now.

    Returns:
        False when no comp grant was active.
    """
    return await _expire_comps(session, user_id, now)


async def set_trial_end(session: AsyncSession, user_id: uuid.UUID, ends_at: datetime) -> Grant:
    """Move the end of the user's trial.

    Raises:
        LookupError: The user has no trial grant.
    """
    grant = await session.scalar(
        select(Grant).where(
            Grant.user_id == user_id,
            Grant.kind == GrantKind.PREMIUM.value,
            Grant.source == GrantSource.TRIAL.value,
        )
    )
    if grant is None:
        msg = f"user {user_id} has no trial grant"
        raise LookupError(msg)
    grant.expires_at = ends_at
    await session.flush()
    return grant


async def claim_pending_comp(
    session: AsyncSession, user_id: uuid.UUID, email: str | None, now: datetime
) -> bool:
    """Turn a comp promised to this email into a grant, consuming the promise.

    A promise whose end has already passed is consumed without a grant.

    Returns:
        True when an unexpired pending comp existed and was granted.
    """
    if not email:
        return False
    pending = (
        await session.execute(
            delete(PendingComp)
            .where(PendingComp.email == email.lower())
            .returning(
                PendingComp.expires_at,
                PendingComp.storage_addon,
                PendingComp.granted_by,
                PendingComp.reason,
            )
        )
    ).first()
    if pending is None or (pending.expires_at is not None and pending.expires_at <= now):
        return False
    await grant_comp(
        session,
        user_id,
        expires_at=pending.expires_at,
        storage_addon=pending.storage_addon,
        granted_by=pending.granted_by or "pending comp",
        reason=pending.reason or "",
        now=now,
    )
    return True
