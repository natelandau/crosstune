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


_WAKE_RUNNER = "wake_runner"


def request_runner_wake(session: AsyncSession) -> None:
    """Ask for the job runner to start a pass once this request's session commits.

    The runner sleeps while idle, so work a request queues would otherwise wait for
    its next due time. Waking only after the commit means the runner never looks for
    a row that is not there yet, and a rolled-back request wakes nothing. A session
    that does not come from `get_session`, like the runner's own, ignores the mark.
    """
    session.info[_WAKE_RUNNER] = True


async def get_session(request: Request) -> AsyncIterator[AsyncSession]:
    """Yield a session from the app's sessionmaker. Commits on success, rolls back on error."""
    async with request.app.state.sessionmaker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        runner = getattr(request.app.state, "job_runner", None)
        if session.info.get(_WAKE_RUNNER) and runner is not None:
            runner.wake()


# Function scope commits before the response is sent and before background tasks run,
# so a client that hears success, and any task scheduled after the write, sees it
# committed. Every route and dependency uses this one alias so the request shares one
# cached session.
DbSession = Annotated[AsyncSession, Depends(get_session, scope="function")]
