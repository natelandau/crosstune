"""FastAPI dependency that resolves the calling user."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request
from sqlalchemy.ext.asyncio import (
    AsyncSession,  # noqa: TC002 -- FastAPI resolves this annotation at route registration
)

from crosstune.auth.tokens import verify_clerk_token
from crosstune.db.session import get_session
from crosstune.errors import UnauthorizedError
from crosstune.models import (
    User,
)
from crosstune.users.service import get_or_create_user


async def current_user(
    request: Request, session: Annotated[AsyncSession, Depends(get_session)]
) -> User:
    """Verify the bearer token and return the local user, creating it on first sight."""
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError
    settings = request.app.state.settings
    claims = await verify_clerk_token(
        token, request.app.state.jwks, settings.clerk_issuer, settings.clerk_authorized_parties
    )
    email = claims.get("email")
    return await get_or_create_user(
        session, claims["sub"], email=email if isinstance(email, str) else None
    )


CurrentUser = Annotated[User, Depends(current_user)]
