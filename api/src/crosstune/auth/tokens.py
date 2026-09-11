"""Verify a Clerk session token."""

from __future__ import annotations

from typing import TYPE_CHECKING

import jwt

from crosstune.errors import UnauthorizedError

if TYPE_CHECKING:
    from crosstune.auth.jwks import JwksCache

CLOCK_LEEWAY_SECONDS = 5


async def verify_clerk_token(
    token: str, jwks: JwksCache, issuer: str, authorized_parties: list[str]
) -> dict:
    """Return the claims of a valid token or raise UnauthorizedError."""
    try:
        kid = jwt.get_unverified_header(token).get("kid")
    except jwt.PyJWTError as exc:
        msg = "Malformed token"
        raise UnauthorizedError(msg) from exc
    if not kid:
        msg = "Token has no kid"
        raise UnauthorizedError(msg)

    try:
        key = await jwks.get_key(kid)
    except Exception as exc:
        msg = "Signing keys unavailable"
        raise UnauthorizedError(msg) from exc
    if key is None:
        msg = "Unknown signing key"
        raise UnauthorizedError(msg)

    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            leeway=CLOCK_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub"]},
        )
    except jwt.PyJWTError as exc:
        msg = "Invalid token"
        raise UnauthorizedError(msg) from exc

    azp = claims.get("azp")
    if authorized_parties and azp not in authorized_parties:
        msg = "Token not issued for this application"
        raise UnauthorizedError(msg)
    return claims
