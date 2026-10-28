"""Per-user advisory locks that serialize a user's writes within a transaction."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import advisory_lock_key, lock_user, share_user_lock
from crosstune.errors import UserBusyError

pytestmark = pytest.mark.anyio


def test_advisory_lock_key_is_stable_and_fits_a_signed_bigint() -> None:
    for _ in range(5):
        user_id = uuid.uuid4()
        key = advisory_lock_key(user_id)
        assert advisory_lock_key(user_id) == key
        assert -(2**63) <= key < 2**63


async def test_lock_user_serializes_two_sessions_for_the_same_user(engine) -> None:
    user_id = uuid.uuid4()
    async with engine.connect() as conn_a, engine.connect() as conn_b:
        trans_a = await conn_a.begin()
        trans_b = await conn_b.begin()
        session_a = AsyncSession(
            bind=conn_a, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        session_b = AsyncSession(
            bind=conn_b, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            await lock_user(session_a, user_id)

            second = asyncio.create_task(lock_user(session_b, user_id))
            await asyncio.sleep(0.1)
            assert not second.done()

            # Releasing the first session's transaction is what frees the lock.
            await trans_a.rollback()
            await asyncio.wait_for(second, timeout=5)
            assert second.done()
        finally:
            await session_a.close()
            await session_b.close()
            await trans_b.rollback()


async def _two_sessions(engine) -> tuple[tuple, tuple]:
    conn_a = await engine.connect()
    conn_b = await engine.connect()
    trans_a = await conn_a.begin()
    trans_b = await conn_b.begin()
    session_a = AsyncSession(
        bind=conn_a, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    session_b = AsyncSession(
        bind=conn_b, expire_on_commit=False, join_transaction_mode="create_savepoint"
    )
    return (conn_a, trans_a, session_a), (conn_b, trans_b, session_b)


@pytest.mark.parametrize("take", [lock_user, share_user_lock])
# A wait that rounds to 0 ms would ask Postgres for no timeout at all.
@pytest.mark.parametrize("wait_seconds", [0.2, 0.0001])
async def test_a_bounded_wait_refuses_once_the_holder_keeps_the_lock(
    engine, take, wait_seconds: float
) -> None:
    user_id = uuid.uuid4()
    (conn_a, trans_a, session_a), (conn_b, trans_b, session_b) = await _two_sessions(engine)
    try:
        await lock_user(session_a, user_id)
        with pytest.raises(UserBusyError):
            await asyncio.wait_for(take(session_b, user_id, wait_seconds=wait_seconds), timeout=5)
    finally:
        await session_a.close()
        await session_b.close()
        await trans_a.rollback()
        await trans_b.rollback()
        await conn_a.close()
        await conn_b.close()


async def test_a_bounded_wait_leaves_later_lock_waits_in_the_transaction_unbounded(engine) -> None:
    async with engine.connect() as conn:
        trans = await conn.begin()
        session = AsyncSession(
            bind=conn, expire_on_commit=False, join_transaction_mode="create_savepoint"
        )
        try:
            await lock_user(session, uuid.uuid4(), wait_seconds=0.2)
            assert (await session.execute(text("show lock_timeout"))).scalar_one() == "0"
        finally:
            await session.close()
            await trans.rollback()
