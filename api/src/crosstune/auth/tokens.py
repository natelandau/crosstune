"""Verify a Clerk session token."""

from __future__ import annotations

import re
from typing import TYPE_CHECKING

import jwt

from crosstune.errors import UnauthorizedError

if TYPE_CHECKING:
    from crosstune.auth.jwks import JwksCache

CLOCK_LEEWAY_SECONDS = 5


def party_allowed(azp: object, parties: list[str], pattern: str) -> bool:
    """True when the token's authorized party is listed or matches the pattern."""
    if not isinstance(azp, str):
        return False
    if azp in parties:
        return True
    return bool(pattern) and re.fullmatch(pattern, azp) is not None


async def verify_clerk_token(
    token: str,
    jwks: JwksCache,
    issuer: str,
    authorized_parties: list[str],
    authorized_party_regex: str = "",
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

    # sid is what sets a session token apart from a JWT template token, which Clerk signs
    # with the same keys for the same issuer and can give a far longer lifetime.
    try:
        claims = jwt.decode(
            token,
            key.key,
            algorithms=["RS256"],
            issuer=issuer,
            leeway=CLOCK_LEEWAY_SECONDS,
            options={"require": ["exp", "iat", "sub", "sid"]},
        )
    except jwt.PyJWTError as exc:
        msg = "Invalid token"
        raise UnauthorizedError(msg) from exc

    if (authorized_parties or authorized_party_regex) and not party_allowed(
        claims.get("azp"), authorized_parties, authorized_party_regex
    ):
        msg = "Token not issued for this application"
        raise UnauthorizedError(msg)
    return claims
