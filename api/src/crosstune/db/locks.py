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
