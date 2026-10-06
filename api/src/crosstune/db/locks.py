"""Per-user Postgres advisory locks that serialize a user's writes within a transaction."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import func, select

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession


def advisory_lock_key(user_id: uuid.UUID) -> int:
    """A stable signed 64-bit key derived from a user id, for pg_advisory_xact_lock."""
    # UUIDv7 leads with a millisecond timestamp, so the trailing bytes carry the entropy.
    return int.from_bytes(user_id.bytes[8:], "big", signed=True)


async def lock_user(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Serialize this user's writes for the rest of the transaction; released with the transaction."""
    await session.execute(select(func.pg_advisory_xact_lock(advisory_lock_key(user_id))))


async def share_user_lock(session: AsyncSession, user_id: uuid.UUID) -> None:
    """Hold off this user's writes for the rest of the transaction, alongside other readers.

    A read that spans several statements sees each one's own commits under read
    committed; holding this keeps every write of the user's out until it ends.
    """
    await session.execute(select(func.pg_advisory_xact_lock_shared(advisory_lock_key(user_id))))


async def lock_clerk_user(session: AsyncSession, clerk_user_id: str) -> None:
    """Serialize account creation and purge for one Clerk id; released with the transaction.

    Uses the two-key form of the advisory lock. Postgres tags it with a different
    objsubid than the single-bigint form lock_user uses, so this key space can never
    collide with a numeric user id lock.
    """
    await session.execute(select(func.pg_advisory_xact_lock(0, func.hashtext(clerk_user_id))))
