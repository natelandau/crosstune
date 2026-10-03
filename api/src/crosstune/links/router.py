"""Resolve a pasted URL before the client saves it."""

from __future__ import annotations

import dataclasses
from typing import TYPE_CHECKING, Annotated

from fastapi import APIRouter, Query, Request
from pydantic import AfterValidator, BaseModel, Field

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import TooManyRequestsError, problem_responses
from crosstune.links.resolve import resolve_link
from crosstune.links.search import service
from crosstune.vocabulary import SEARCHABLE_PROVIDERS, Provider, SearchStatus

if TYPE_CHECKING:
    from crosstune.models.user import User
    from crosstune.ratelimit import RateLimiter

router = APIRouter(prefix="/v1/links", tags=["links"])


class ResolveRequest(BaseModel):
    """Body of a resolve request: the URL the user just pasted."""

    url: str = Field(min_length=1, max_length=2048)


class ResolveResponse(BaseModel):
    """Provider, canonical URL, title, and artwork for a resolved link."""

    url: str
    provider: str
    provider_ref: str | None
    title: str | None
    artwork_url: str | None


class SearchResult(BaseModel):
    """One recording a service found, in the form a paste of its URL would store."""

    url: str
    provider: Provider
    provider_ref: str | None
    title: str
    subtitle: str | None
    artwork_url: str | None


class SearchGroup(BaseModel):
    """One service's answer to a search, and its own search page as the fallback."""

    provider: Provider
    status: SearchStatus
    results: list[SearchResult]
    search_url: str


class SearchResponse(BaseModel):
    """One group per requested service, inline services first."""

    groups: list[SearchGroup]


def _searchable(providers: list[Provider]) -> list[Provider]:
    if unsearchable := [p for p in providers if p not in SEARCHABLE_PROVIDERS]:
        msg = f"{unsearchable[0].value} cannot be searched"
        raise ValueError(msg)
    return providers


def _charge(limiter: RateLimiter, user: User) -> None:
    # Called in the handler rather than as a dependency, which FastAPI runs before validating
    # the request, so a malformed request never spends the caller's limit.
    wait = limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)


@router.post("/resolve", responses=problem_responses(429))
async def resolve(
    body: ResolveRequest,
    request: Request,
    user: CurrentUser,
    session: DbSession,
) -> ResolveResponse:
    """Provider, canonical URL, title, and artwork for a pasted link."""
    # Each resolve is an outbound fetch.
    _charge(request.app.state.link_resolve_limiter, user)
    settings = request.app.state.settings
    # Resolving the caller opened a transaction on a pooled connection. Commit it so the
    # fetch, which can wait out its whole timeout, holds nothing from the pool.
    await session.commit()
    link = await resolve_link(
        body.url, request.app.state.http_client, settings.link_resolve_timeout_seconds
    )
    return ResolveResponse(**dataclasses.asdict(link))


@router.get("/search", responses=problem_responses(429))
async def search(
    request: Request,
    user: CurrentUser,
    session: DbSession,
    q: Annotated[str, Query(min_length=1, max_length=200)],
    providers: Annotated[
        list[Provider],
        Query(min_length=1, max_length=len(SEARCHABLE_PROVIDERS)),
        AfterValidator(_searchable),
    ],
    country: Annotated[str, Query(pattern=r"^[A-Za-z]{2}$")] = "US",
) -> SearchResponse:
    """Recordings matching the text on each requested service, grouped by service."""
    state = request.app.state
    # Each search fans out to other services.
    _charge(state.link_search_limiter, user)
    # Resolving the caller opened a transaction on a pooled connection. Commit it so the
    # fan-out, which can wait out its whole timeout, holds nothing from the pool.
    await session.commit()
    groups = await service.search(
        q,
        providers,
        country.upper(),
        adapters=state.search_adapters,
        client=state.http_client,
        timeout=state.settings.link_resolve_timeout_seconds,
        backoff=state.search_backoff,
    )
    return SearchResponse(
        groups=[
            SearchGroup(
                provider=g.provider,
                status=g.status,
                results=[SearchResult(**dataclasses.asdict(hit)) for hit in g.results],
                search_url=g.search_url,
            )
            for g in groups
        ]
    )
