"""Per-user advisory locks that serialize a user's writes within a transaction."""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import advisory_lock_key, lock_user

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
