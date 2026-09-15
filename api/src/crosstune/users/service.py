"""User provisioning and removal."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert

from crosstune.models import User
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
    """
    now = utc_now()
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


async def delete_user_by_clerk_id(session: AsyncSession, clerk_user_id: str) -> uuid.UUID | None:
    """Hard-delete the user. Foreign keys cascade to every table they own.

    Args:
        session: The session to write through.
        clerk_user_id: The Clerk subject of the account.

    Returns:
        uuid.UUID | None: The deleted user's id, or None when no such user existed.
    """
    user_id = await session.scalar(select(User.id).where(User.clerk_user_id == clerk_user_id))
    if user_id is None:
        return None
    await session.execute(delete(User).where(User.id == user_id))
    return user_id
