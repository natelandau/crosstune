"""Sync endpoints."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 -- FastAPI resolves this annotation at route registration
)

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.session import get_session
from crosstune.errors import VALIDATION_RESPONSE
from crosstune.links.resolve import ResolvedLink, resolve_link, unresolved_link
from crosstune.schemas.common import PullResponse, PushRequest, PushResponse
from crosstune.sync.pull import pull_since
from crosstune.sync.push import apply_push

if TYPE_CHECKING:
    import httpx2

    from crosstune.schemas.common import Change

log = logging.getLogger(__name__)

# Enough parallelism to clear a batch of pasted links quickly without hammering one provider.
LINK_RESOLVE_CONCURRENCY = 8
# Whole-batch ceiling. Past it the push proceeds and the stragglers are stored untitled.
LINK_RESOLVE_BUDGET_SECONDS = 20.0

# server_seq is a bigint, so a wider cursor is a client bug, not a query.
MAX_CURSOR = 2**63 - 1

router = APIRouter(prefix="/v1/sync", tags=["sync"])


def _untitled_link_urls(changes: list[Change]) -> set[str]:
    return {
        change.data["url"]
        for change in changes
        if change.table == "recording_links"
        and change.op == "upsert"
        and change.data
        and change.data.get("title") is None
        and isinstance(change.data.get("url"), str)
    }


async def _resolve_untitled_links(
    changes: list[Change],
    client: httpx2.AsyncClient,
    timeout: float,  # noqa: ASYNC109 -- forwarded to httpx2's per-request timeout, not asyncio cancellation
) -> dict[str, ResolvedLink]:
    """Resolve every untitled link in a batch, so the push transaction waits on no network call."""
    urls = _untitled_link_urls(changes)
    if not urls:
        return {}
    # Each URL starts at its offline form, so a link the budget cuts off is stored untitled.
    resolved = {url: unresolved_link(url) for url in urls}
    semaphore = asyncio.Semaphore(LINK_RESOLVE_CONCURRENCY)

    async def one(url: str) -> None:
        async with semaphore:
            resolved[url] = await resolve_link(url, client, timeout)

    tasks = [asyncio.create_task(one(url)) for url in urls]
    outcomes: list[object] = []
    try:
        async with asyncio.timeout(LINK_RESOLVE_BUDGET_SECONDS):
            outcomes = await asyncio.gather(*tasks, return_exceptions=True)
    except TimeoutError:
        log.warning("link resolution budget expired", extra={"links": len(urls)})
        # Reap the tasks the expiry cancelled.
        await asyncio.gather(*tasks, return_exceptions=True)
    for outcome in outcomes:
        if isinstance(outcome, BaseException):
            log.warning("link resolution raised", exc_info=outcome)
    return resolved


@router.post("/push", responses=VALIDATION_RESPONSE)
async def push(
    body: PushRequest,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
) -> PushResponse:
    """Apply a batch of client changes. One result per change, in order."""
    settings = request.app.state.settings
    # Resolving the user opened a transaction, and with it a pooled connection. Commit it
    # so the resolution pass, which can wait on the network for its whole budget, holds
    # no connection out of the pool while it does.
    await session.commit()
    resolved = await _resolve_untitled_links(
        body.changes, request.app.state.http_client, settings.resolver_timeout_seconds
    )

    async def enrich(url: str) -> ResolvedLink:
        # A url the pre-pass did not collect still resolves to something storable.
        return resolved.get(url) or unresolved_link(url)

    results = await apply_push(session, user.id, body.changes, enrich_link=enrich)
    return PushResponse(results=results)


@router.get("/pull", responses=VALIDATION_RESPONSE)
async def pull(
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    since: Annotated[int, Query(ge=0, le=MAX_CURSOR)] = 0,
) -> PullResponse:
    """Every one of the caller's rows changed after `since`, oldest first."""
    limit = request.app.state.settings.pull_page_size
    rows, next_since, has_more = await pull_since(session, user.id, since, limit)
    return PullResponse(rows=rows, next_since=next_since, has_more=has_more)
