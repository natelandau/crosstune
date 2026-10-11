"""Reset a Clerk account to a brand-new one."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import delete, select

from crosstune.db.locks import lock_clerk_user
from crosstune.models import User
from crosstune.users.service import get_or_create_user

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings


@dataclass(frozen=True)
class ClearedAccount:
    """The account's new row, and the id of the row a clear deleted, if there was one."""

    user: User
    old_user_id: uuid.UUID | None


async def clear_account(
    session: AsyncSession,
    clerk_user_id: str,
    email: str | None,
    settings: Settings,
) -> ClearedAccount:
    """Delete the account's rows, then provision it again with a fresh trial.

    Unlike `purge_account`, this never denylists the Clerk id, so the same sign-in
    keeps working. The files stay in the bucket: the caller deletes the old id's prefix
    once this commits, so a rolled-back clear never leaves rows without their files.

    Args:
        session: The session to write through.
        clerk_user_id: The Clerk subject of the account.
        email: The account's address, or None.
        settings: The plan sizes for the new entitlements row.

    Returns:
        ClearedAccount: The newly provisioned row, with a new id, and the old row's id.
    """
    await lock_clerk_user(session, clerk_user_id)
    old_user_id = await session.scalar(select(User.id).where(User.clerk_user_id == clerk_user_id))
    if old_user_id is not None:
        # Foreign keys cascade to every table the user owns.
        await session.execute(delete(User).where(User.id == old_user_id))
    user = await get_or_create_user(session, clerk_user_id, email, settings)
    return ClearedAccount(user=user, old_user_id=old_user_id)
