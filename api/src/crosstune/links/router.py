"""Resolve a pasted URL before the client saves it."""

from __future__ import annotations

import dataclasses
from typing import Annotated

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 -- FastAPI resolves this annotation at route registration
)

from crosstune.auth.deps import (
    CurrentUser,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.db.session import get_session
from crosstune.errors import TooManyRequestsError, problem_responses
from crosstune.links.resolve import resolve_link

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


async def within_resolve_limit(request: Request, user: CurrentUser) -> None:
    """Refuse a caller past their resolve limit, since each resolve is an outbound fetch."""
    wait = request.app.state.link_resolve_limiter.hit(user.id)
    if wait is not None:
        raise TooManyRequestsError(wait)


@router.post("/resolve", responses=problem_responses(429))
async def resolve(
    body: ResolveRequest,
    request: Request,
    _: Annotated[None, Depends(within_resolve_limit)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ResolveResponse:
    """Provider, canonical URL, title, and artwork for a pasted link."""
    settings = request.app.state.settings
    # Resolving the caller opened a transaction on a pooled connection. Commit it so the
    # fetch, which can wait out its whole timeout, holds nothing from the pool.
    await session.commit()
    link = await resolve_link(
        body.url, request.app.state.http_client, settings.resolver_timeout_seconds
    )
    return ResolveResponse(**dataclasses.asdict(link))
