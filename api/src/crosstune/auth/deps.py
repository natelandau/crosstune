"""FastAPI dependency that resolves the calling user."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from crosstune.auth.account_created import ACCOUNT_CREATED_STATE_KEY
from crosstune.auth.tokens import verify_clerk_token
from crosstune.client_sightings import SIGHTING_USER_STATE_KEY
from crosstune.db.session import (
    DbSession,  # noqa: TC001 -- FastAPI resolves this annotation at route registration
)
from crosstune.errors import UnauthorizedError
from crosstune.models import (
    User,
)
from crosstune.users.service import provision_user

# Where the body admission middleware leaves the claims it verified, so they are not
# verified twice.
CLAIMS_STATE_KEY = "clerk_claims"


async def verify_bearer(request: Request) -> dict:
    """Verify the request's bearer token against the app's Clerk settings.

    Args:
        request: The incoming request.

    Returns:
        dict: The token's claims.

    Raises:
        UnauthorizedError: The header is missing, or the token is not valid for this API.
    """
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        raise UnauthorizedError
    settings = request.app.state.settings
    return await verify_clerk_token(
        token,
        request.app.state.jwks,
        settings.clerk_issuer,
        settings.clerk_authorized_parties,
        settings.clerk_authorized_party_regex,
    )


async def current_user(request: Request, session: DbSession) -> User:
    """Verify the bearer token and return the local user, creating it on first sight.

    Also name the user to `VersionGate`, which records the client version once the
    request's own transaction has ended.
    """
    claims = getattr(request.state, CLAIMS_STATE_KEY, None) or await verify_bearer(request)
    email = claims.get("email")
    user, started = await provision_user(
        session,
        claims["sub"],
        email=email if isinstance(email, str) else None,
        settings=request.app.state.settings,
    )
    if started is not None:
        setattr(request.state, ACCOUNT_CREATED_STATE_KEY, started)
    setattr(request.state, SIGHTING_USER_STATE_KEY, user.id)
    return user


CurrentUser = Annotated[User, Depends(current_user)]
