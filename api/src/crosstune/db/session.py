"""Per-request session dependency."""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated

from fastapi import (
    Depends,
    Request,
)
from sqlalchemy.ext.asyncio import (
    AsyncSession,
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a session from the app's sessionmaker. Commits on success, rolls back on error."""
    async with request.app.state.sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# Function scope commits before the response is sent and before background tasks run,
# so a client that hears success, and any task scheduled after the write, sees it
# committed. Every route and dependency uses this one alias so the request shares one
# cached session.
DbSession = Annotated[AsyncSession, Depends(get_session, scope="function")]
