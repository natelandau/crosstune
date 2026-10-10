"""User provisioning and removal."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING

from sqlalchemy import delete, literal_column, or_, select, update
from sqlalchemy.dialects.postgresql import insert

from crosstune.billing.access import refresh_entitlement
from crosstune.billing.grants import claim_pending_comp, start_trial
from crosstune.db.base import new_uuid7, utc_now
from crosstune.db.locks import lock_clerk_user
from crosstune.errors import AccountDeletedError
from crosstune.models import DeletedAccount, User

if TYPE_CHECKING:
    import uuid
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings


async def get_or_create_user(
    session: AsyncSession,
    clerk_user_id: str,
    email: str | None,
    settings: Settings,
) -> User:
    """Insert-if-absent, safe under concurrent first requests from one new user.

    Args:
        session: The session to write through.
        clerk_user_id: The Clerk subject the token was issued for.
        email: The address the token carried, or None. A known address is never
            overwritten with nothing, since not every token carries the claim.
        settings: The plan sizes for the entitlements row. A user this call inserts gets
            a pending comp for their email or else a trial.

    Returns:
        User: The stored row for this Clerk user.

    Raises:
        AccountDeletedError: The Clerk id belongs to a purged account, which must
            never be re-provisioned.
    """
    now = utc_now()
    existing = await session.scalar(select(User).where(User.clerk_user_id == clerk_user_id))
    if existing is not None:
        if email is not None and existing.email != email:
            existing.email = email
            existing.updated_at = now
        return existing

    # Serializes against a concurrent purge_account for this id, so a purge that commits
    # its denylist row between this select and the check below can never be missed.
    await lock_clerk_user(session, clerk_user_id)

    denylisted = await session.scalar(
        select(DeletedAccount).where(DeletedAccount.clerk_user_id == clerk_user_id)
    )
    if denylisted is not None:
        raise AccountDeletedError

    stmt = insert(User).values(
        id=new_uuid7(), clerk_user_id=clerk_user_id, email=email, created_at=now, updated_at=now
    )
    if email is None:
        stmt = stmt.on_conflict_do_nothing(index_elements=[User.clerk_user_id])
    else:
        stmt = stmt.on_conflict_do_update(
            index_elements=[User.clerk_user_id],
            set_={"email": email, "updated_at": now},
            where=User.email.is_distinct_from(email),
        )
    # xmax is 0 only on a freshly inserted row, so a conflict that updated an existing
    # row is not mistaken for this request creating the user.
    inserted = await session.scalar(stmt.returning(literal_column("xmax = 0")))
    user = (
        await session.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    ).scalar_one()
    if inserted:
        if not await claim_pending_comp(session, user.id, email, now):
            await start_trial(session, user.id, settings, now)
        await refresh_entitlement(session, user.id, settings, now)
    return user


# How stale last_synced_at may grow before a sync rewrites it, so most syncs write nothing.
LAST_SYNCED_GRANULARITY = timedelta(hours=1)


async def touch_last_synced(session: AsyncSession, user_id: uuid.UUID, now: datetime) -> None:
    """Record that the user synced, at most once an hour.

    A sync that finds the user row locked by another transaction skips the write rather
    than waiting on it: the sync already holds the user lock, and a request holding the
    row while it waits for that lock would otherwise deadlock with it. A later sync
    records the time instead.

    Args:
        session: The request's session; the caller commits.
        user_id: The syncing user.
        now: The time to record.
    """
    due = (
        select(User.id)
        .where(
            User.id == user_id,
            or_(
                User.last_synced_at.is_(None),
                User.last_synced_at < now - LAST_SYNCED_GRANULARITY,
            ),
        )
        .with_for_update(skip_locked=True)
    )
    await session.execute(
        update(User)
        .where(User.id.in_(due.scalar_subquery()))
        .values(last_synced_at=now)
        .execution_options(synchronize_session=False)
    )


async def purge_account(session: AsyncSession, clerk_user_id: str) -> uuid.UUID | None:
    """Denylist the Clerk id, then hard-delete the user.

    Foreign keys cascade to every table the user owns.

    Args:
        session: The session to write through.
        clerk_user_id: The Clerk subject of the account.

    Returns:
        uuid.UUID | None: The id of the row this call deleted, or None when no such
        user existed. A duplicate webhook delivery racing this one gets None.
    """
    await lock_clerk_user(session, clerk_user_id)
    stmt = insert(DeletedAccount).values(clerk_user_id=clerk_user_id, deleted_at=utc_now())
    stmt = stmt.on_conflict_do_nothing(index_elements=[DeletedAccount.clerk_user_id])
    await session.execute(stmt)
    return await session.scalar(
        delete(User).where(User.clerk_user_id == clerk_user_id).returning(User.id)
    )
