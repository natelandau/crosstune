"""Per-user Postgres advisory locks that serialize a user's writes within a transaction."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

if TYPE_CHECKING:
    import uuid
    from collections.abc import AsyncGenerator

    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession

log = logging.getLogger(__name__)


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


# First keys of the two-key form, apart from the `0` that `lock_clerk_user` uses.
_NOTICE_LOCK_NAMESPACE = 1
_BILLING_LOCK_NAMESPACE = 2


async def try_notice_lock(connection: AsyncConnection, notice_key: str) -> bool:
    """Take the session-level lock on one operator announcement, or return False if held.

    The lock belongs to `connection` until `release_notice_lock` or the connection closes,
    so it survives the commits a run makes between batches.
    """
    result = await connection.execute(
        select(func.pg_try_advisory_lock(_NOTICE_LOCK_NAMESPACE, func.hashtext(notice_key)))
    )
    return bool(result.scalar_one())


async def release_notice_lock(connection: AsyncConnection, notice_key: str) -> None:
    """Release the lock `try_notice_lock` took on this connection."""
    await connection.execute(
        select(func.pg_advisory_unlock(_NOTICE_LOCK_NAMESPACE, func.hashtext(notice_key)))
    )


@asynccontextmanager
async def billing_lock(
    session: AsyncSession, user_id: uuid.UUID, *, wait: bool = True
) -> AsyncGenerator[bool]:
    """Hold the user's billing lock for the block, across every commit `session` makes in it.

    Account deletion, a withdrawal, and the pass that finishes withdrawals each run their
    Stripe steps under it, so none of them starts between another's refund and its cancel.
    It is a session-level lock on a connection of its own, since those steps commit and so
    end any transaction-level lock. `session` is committed first, so no row lock it holds
    can wait on a lock holder that is itself waiting on this lock.

    Args:
        session: The caller's session; its engine supplies the lock's connection.
        user_id: The account whose billing steps are serialized.
        wait: Wait for the lock, or yield False at once when another holder has it.

    Yields:
        Whether the lock is held for the block.
    """
    await session.commit()
    bind = session.bind
    if bind is None:
        msg = "A billing lock needs a session bound to an engine or a connection"
        raise RuntimeError(msg)
    engine = bind if isinstance(bind, AsyncEngine) else bind.engine
    key = (_BILLING_LOCK_NAMESPACE, func.hashtext(str(user_id)))
    async with engine.connect() as connection:
        take = func.pg_advisory_lock if wait else func.pg_try_advisory_lock
        result = await connection.execute(select(take(*key)))
        held = True if wait else bool(result.scalar_one())
        # The lock outlives the transaction, so the connection does not sit idle in one.
        await connection.commit()
        try:
            yield held
        finally:
            if held:
                try:
                    await connection.execute(select(func.pg_advisory_unlock(*key)))
                    await connection.commit()
                except SQLAlchemyError:
                    # Closing the connection releases the lock anyway.
                    log.warning("could not release a billing lock", extra={"user": str(user_id)})
