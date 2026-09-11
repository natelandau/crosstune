"""Per-request session dependency."""

from __future__ import annotations

from typing import TYPE_CHECKING

from fastapi import (
    Request,  # noqa: TC002 -- FastAPI resolves this annotation at runtime to inject the request
)

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a session from the app's sessionmaker. Commits on success, rolls back on error."""
    async with request.app.state.sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
