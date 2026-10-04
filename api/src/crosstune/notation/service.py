"""Queries and transitions shared by the notation router and the job runner."""

from __future__ import annotations

from typing import TYPE_CHECKING

from crosstune.db.base import next_server_seq
from crosstune.errors import ConflictError, NotFoundError
from crosstune.models import NotationPage, Tune

if TYPE_CHECKING:
    import uuid

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.vocabulary import NotationPageState


async def owned_page(session: AsyncSession, user_id: uuid.UUID, page_id: uuid.UUID) -> NotationPage:
    """The caller's live page on a live tune, or a 404 that does not reveal whether the id exists.

    Args:
        session: The session to query through.
        user_id: The caller.
        page_id: The page named in the URL.

    Returns:
        NotationPage: The row.
    """
    page = await session.get(NotationPage, page_id)
    if page is None or page.user_id != user_id:
        raise NotFoundError
    await require_live(session, page)
    return page


async def require_live(session: AsyncSession, page: NotationPage) -> None:
    """Raise a 404 when the page or its tune is tombstoned.

    The tune is read from the database, not the session's identity map, so a caller
    that re-checks under the user's lock sees a delete committed meanwhile.

    Args:
        session: The session to query through.
        page: The page, already read or refreshed by the caller.
    """
    if page.deleted_at is not None:
        raise NotFoundError
    tune = await session.get(Tune, page.tune_id, populate_existing=True)
    if tune is None or tune.deleted_at is not None:
        raise NotFoundError


def require_state(page: NotationPage, expected: NotationPageState) -> None:
    """Raise a conflict naming the page's actual state when it is not the expected one.

    Args:
        page: The page to check.
        expected: The state the caller's operation allows.
    """
    if page.state != expected:
        msg = f"Page is {page.state}, not {expected}"
        raise ConflictError(msg)


def bump_page_server_seq(page: NotationPage) -> None:
    """Take a new server_seq so every device pulls the change. updated_at stays the client's."""
    page.server_seq = next_server_seq()
