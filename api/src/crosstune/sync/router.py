"""Sync endpoints."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
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
from crosstune.schemas.legacy import Names, song_names
from crosstune.sync.pull import pull_since
from crosstune.sync.push import apply_push

if TYPE_CHECKING:
    from collections.abc import Callable

    import httpx2

    from crosstune.schemas.common import Change

log = logging.getLogger(__name__)

# Enough parallelism to clear a batch of pasted links quickly without hammering one provider.
LINK_RESOLVE_CONCURRENCY = 8
# Whole-batch ceiling. Past it the push proceeds and the stragglers are stored untitled.
LINK_RESOLVE_BUDGET_SECONDS = 20.0

# server_seq is a bigint, so a wider cursor is a client bug, not a query.
MAX_CURSOR = 2**63 - 1

NamesQuery = Annotated[
    Names,
    Query(
        description=(
            "The names a response uses. `songs`, the default, is the wire's first names, "
            "kept for installs that predate tunes."
        )
    ),
]


def _song_names_body(
    response: PushResponse | PullResponse, entries: str, names: Names, request: Request
) -> JSONResponse | None:
    """The response rewritten into song names, or None to send it as is for tune names."""
    if names == "tunes":
        return None
    # One line per request from an install that has not updated, so its absence shows when
    # song names can be retired.
    log.info("sync: song names", extra={"client_version": request.headers.get("x-client-version")})
    body: dict[str, Any] = response.model_dump(mode="json")
    body[entries] = [song_names(entry) for entry in body[entries]]
    return JSONResponse(body)


def _push_in_names(
    response: PushResponse, names: Names, request: Request
) -> PushResponse | JSONResponse:
    return _song_names_body(response, "results", names, request) or response


def _pull_in_names(
    response: PullResponse, names: Names, request: Request
) -> PullResponse | JSONResponse:
    return _song_names_body(response, "rows", names, request) or response


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
    allow_fetch: Callable[[], bool],
) -> dict[str, ResolvedLink]:
    """Resolve the untitled links in a batch, so the push transaction waits on no network call.

    Args:
        changes: The pushed changes.
        client: The outbound HTTP client.
        timeout: Seconds each fetch may take.
        allow_fetch: Called once per link; False leaves that link untitled unfetched.

    Returns:
        dict[str, ResolvedLink]: What each untitled URL resolved to, or its offline form.
    """
    urls = _untitled_link_urls(changes)
    if not urls:
        return {}
    # Each URL starts at its offline form, so a link the budget or the limit cuts off is
    # stored untitled.
    resolved = {url: unresolved_link(url) for url in urls}
    urls = {url for url in urls if allow_fetch()}
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


@router.post("/push", response_model=PushResponse, responses=VALIDATION_RESPONSE)
async def push(
    body: PushRequest,
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    names: NamesQuery = "songs",
) -> PushResponse | JSONResponse:
    """Apply a batch of client changes. One result per change, in order."""
    settings = request.app.state.settings
    # Resolving the user opened a transaction, and with it a pooled connection. Commit it
    # so the resolution pass, which can wait on the network for its whole budget, holds
    # no connection out of the pool while it does.
    await session.commit()
    # Each fetch counts against the same limit as the resolve route, so a push is no way
    # around it.
    limiter = request.app.state.link_resolve_limiter
    resolved = await _resolve_untitled_links(
        body.changes,
        request.app.state.http_client,
        settings.link_resolve_timeout_seconds,
        allow_fetch=lambda: limiter.hit(user.id) is None,
    )

    async def enrich(url: str) -> ResolvedLink:
        # A url the pre-pass did not collect still resolves to something storable.
        return resolved.get(url) or unresolved_link(url)

    results = await apply_push(session, user.id, body.changes, enrich_link=enrich)
    return _push_in_names(PushResponse(results=results), names, request)


@router.get("/pull", response_model=PullResponse, responses=VALIDATION_RESPONSE)
async def pull(
    request: Request,
    user: CurrentUser,
    session: Annotated[AsyncSession, Depends(get_session)],
    since: Annotated[int, Query(ge=0, le=MAX_CURSOR)] = 0,
    names: NamesQuery = "songs",
) -> PullResponse | JSONResponse:
    """Every one of the caller's rows changed after `since`, oldest first."""
    limit = request.app.state.settings.pull_page_size
    rows, next_since, has_more = await pull_since(session, user.id, since, limit)
    return _pull_in_names(
        PullResponse(rows=rows, next_since=next_since, has_more=has_more), names, request
    )
