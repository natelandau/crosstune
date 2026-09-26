"""User provisioning and removal."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from crosstune.db.locks import lock_clerk_user
from crosstune.errors import AccountDeletedError
from crosstune.models import DeletedAccount, User
from crosstune.models.user import new_uuid7, utc_now

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession


async def get_or_create_user(
    session: AsyncSession, clerk_user_id: str, email: str | None = None
) -> User:
    """Insert-if-absent, safe under concurrent first requests from one new user.

    Args:
        session: The session to write through.
        clerk_user_id: The Clerk subject the token was issued for.
        email: The address the token carried, if any. A known address is never
            overwritten with nothing, since not every token carries the claim.

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
    await session.execute(stmt)
    result = await session.execute(select(User).where(User.clerk_user_id == clerk_user_id))
    return result.scalar_one()


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
