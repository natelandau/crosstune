"""Per-user Postgres advisory locks that serialize a user's writes within a transaction."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING

import asyncpg
from sqlalchemy import func, select, text
from sqlalchemy.exc import DBAPIError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine

from crosstune.errors import UserBusyError

if TYPE_CHECKING:
    import uuid
    from collections.abc import AsyncGenerator

    from sqlalchemy.engine import Result
    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncSession
    from sqlalchemy.sql.functions import Function

log = logging.getLogger(__name__)


def advisory_lock_key(user_id: uuid.UUID) -> int:
    """A stable signed 64-bit key derived from a user id, for pg_advisory_xact_lock."""
    # UUIDv7 leads with a millisecond timestamp, so the trailing bytes carry the entropy.
    return int.from_bytes(user_id.bytes[8:], "big", signed=True)


async def lock_user(
    session: AsyncSession, user_id: uuid.UUID, *, wait_seconds: float | None = None
) -> None:
    """Serialize this user's writes for the rest of the transaction; released with the transaction.

    Args:
        session: The transaction that takes the lock.
        user_id: Whose writes are serialized.
        wait_seconds: Seconds to wait before refusing with UserBusyError, or None to wait as
            long as the holder keeps the lock.
    """
    await _take(session, func.pg_advisory_xact_lock(advisory_lock_key(user_id)), wait_seconds)


async def share_user_lock(
    session: AsyncSession, user_id: uuid.UUID, *, wait_seconds: float | None = None
) -> None:
    """Hold off this user's writes for the rest of the transaction, alongside other readers.

    A read that spans several statements sees each one's own commits under read
    committed; holding this keeps every write of the user's out until it ends.

    Args:
        session: The transaction that takes the lock.
        user_id: Whose writes are held off.
        wait_seconds: Seconds to wait before refusing with UserBusyError, or None to wait as
            long as a writer keeps the lock.
    """
    await _take(
        session, func.pg_advisory_xact_lock_shared(advisory_lock_key(user_id)), wait_seconds
    )


async def _take(
    executor: AsyncSession | AsyncConnection, lock: Function, wait_seconds: float | None
) -> Result:
    """Take an advisory lock, giving up after `wait_seconds` seconds when one is given.

    A request waits with a pooled connection checked out, so an unbounded wait lets one
    account's queued requests hold every connection the other accounts need.

    Raises:
        UserBusyError: When the lock is still held once `wait_seconds` runs out.
    """
    if wait_seconds is None:
        return await executor.execute(select(lock))
    # A lock_timeout of 0 means no timeout at all, so the shortest wait is 1 ms.
    timeout_ms = max(1, round(wait_seconds * 1000))
    await executor.execute(text(f"set local lock_timeout = '{timeout_ms}ms'"))
    try:
        result = await executor.execute(select(lock))
    except DBAPIError as exc:
        cause = exc.orig.__cause__ if exc.orig is not None else None
        if isinstance(cause, asyncpg.exceptions.LockNotAvailableError):
            raise UserBusyError from exc
        raise
    # Only this wait is bounded; the row locks the rest of the transaction takes are not.
    await executor.execute(text("set local lock_timeout to default"))
    return result


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
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    wait: bool = True,
    wait_seconds: float | None = None,
) -> AsyncGenerator[bool]:
    """Hold the user's billing lock for the block, across every commit `session` makes in it.

    Account deletion, a withdrawal, and the pass that finishes withdrawals each run their
    Stripe steps under it, so none of them starts between another's refund and its cancel.
    It is a session-level lock, since those steps commit and so end any transaction-level
    lock. `session` is committed first, so no row lock it holds can wait on a lock holder
    that is itself waiting on this lock.

    For the block, `session` runs on the lock's connection. A holder then needs no second
    pooled connection, so holders from many accounts at once can never take every
    connection while each waits for another.

    Args:
        session: The caller's session, bound to an engine. It is committed on entry, and
            on leaving the block it is committed, or rolled back when the block raises.
        user_id: The account whose billing steps are serialized.
        wait: Wait for the lock, or yield False at once when another holder has it.
        wait_seconds: How long a wait may last before refusing with UserBusyError, or None
            to wait as long as the holder keeps the lock.

    Yields:
        Whether the lock is held for the block.

    Raises:
        UserBusyError: When `wait_seconds` runs out before the lock is free.
    """
    engine = session.bind
    if not isinstance(engine, AsyncEngine):
        msg = "A billing lock needs a session bound to an engine"
        raise TypeError(msg)
    await session.commit()
    key = (_BILLING_LOCK_NAMESPACE, func.hashtext(str(user_id)))
    async with engine.connect() as connection:
        take = func.pg_advisory_lock if wait else func.pg_try_advisory_lock
        result = await _take(connection, take(*key), wait_seconds if wait else None)
        held = True if wait else bool(result.scalar_one())
        # The lock outlives the transaction, so the connection does not sit idle in one.
        await connection.commit()
        session.bind = connection
        try:
            yield held
            await session.commit()
        except BaseException:
            try:
                await session.rollback()
            except SQLAlchemyError:
                # The block's own error is the one the caller handles.
                log.exception("could not roll back under a billing lock")
            raise
        finally:
            session.bind = engine
            if held:
                await _release_billing_lock(connection, key, user_id)


async def _release_billing_lock(
    connection: AsyncConnection, key: tuple[int, Function], user_id: uuid.UUID
) -> None:
    try:
        await connection.execute(select(func.pg_advisory_unlock(*key)))
        await connection.commit()
    except BaseException as exc:
        # A session-level lock survives a return to the pool, so the connection is closed.
        log.warning("could not release a billing lock", extra={"user": str(user_id)})
        await connection.invalidate()
        if not isinstance(exc, SQLAlchemyError):
            raise
