"""Tokens and signed snapshot URLs for Apple's map services, signed with the Maps key."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal
from urllib.parse import quote

import jwt
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature

from crosstune.places.maps import MapsError
from crosstune.places.matching import is_precise

if TYPE_CHECKING:
    from crosstune.places.maps import AppleMaps

SNAPSHOT_HOST = "https://snapshot.apple-mapkit.com"
SNAPSHOT_PATH = "/api/v1/snapshot"
TOKEN_LIFETIME_SECONDS = 1_800
# Issued-at is backdated so a server clock slightly ahead of Apple's does not get a fresh token refused.
CLOCK_SKEW_SECONDS = 5
MIN_SNAPSHOT_SIDE = 50
MAX_SNAPSHOT_SIDE = 640
# Four decimals is about 11 m, so repeat views of one place reuse one URL under the daily quota.
_COORDINATE_DECIMALS = 4
_ZOOM = 16
_LAT_LIMIT = 89.9999
_LON_LIMIT = 179.9999
_OVERLAY_COLOR = "0a84ff"
_COORDINATE_BYTES = 32

Scheme = Literal["light", "dark"]


@dataclass(frozen=True, slots=True)
class MapKitToken:
    """A MapKit JS token and the instant it stops working."""

    token: str
    expires_at: datetime


def issue_token(maps: AppleMaps, *, origin: str) -> MapKitToken:
    """Sign a short-lived MapKit JS token that only `origin` can use.

    Returns:
        MapKitToken: The ES256 JWT and its expiry.

    Raises:
        MapsError: If the key cannot sign.
    """
    issued = int(maps.clock())
    expires = issued + TOKEN_LIFETIME_SECONDS
    try:
        token = jwt.encode(
            {
                "iss": maps.team_id,
                "iat": issued - CLOCK_SKEW_SECONDS,
                "exp": expires,
                "scope": "mapkit_js",
                "origin": origin,
            },
            maps.private_key,
            algorithm="ES256",
            headers={"kid": maps.key_id},
        )
    except (jwt.PyJWTError, ValueError, TypeError):
        # Dropping the cause keeps the signing key out of any captured traceback.
        msg = "could not sign the MapKit token"
        raise MapsError(msg) from None
    return MapKitToken(token=token, expires_at=datetime.fromtimestamp(expires, tz=UTC))


def sign_snapshot_path(maps: AppleMaps, path_and_query: str) -> str:
    """Sign a snapshot path and query the way Apple's snapshot service verifies it.

    Apple expects the raw 64-byte r||s signature, not the DER form `cryptography` returns.

    Returns:
        str: The base64url signature without padding, to append as `&signature=`.
    """
    der = maps.private_key.sign(path_and_query.encode(), ec.ECDSA(hashes.SHA256()))
    r, s = decode_dss_signature(der)
    raw = r.to_bytes(_COORDINATE_BYTES, "big") + s.to_bytes(_COORDINATE_BYTES, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def snapshot_url(
    maps: AppleMaps,
    *,
    lat: float,
    lon: float,
    accuracy_m: int | None,
    width: int,
    height: int,
    scheme: Scheme,
) -> str:
    """Build a signed snapshot URL: a pin for a precise point, else a circle of the fix's radius.

    Returns:
        str: The URL, with `signature` as its last parameter.
    """
    # Apple's ranges are open, so rounding up to a pole or the antimeridian is pulled back in.
    lat = max(-_LAT_LIMIT, min(_LAT_LIMIT, round(lat, _COORDINATE_DECIMALS)))
    lon = max(-_LON_LIMIT, min(_LON_LIMIT, round(lon, _COORDINATE_DECIMALS)))
    point = f"{lat:.4f},{lon:.4f}"
    params = {"size": f"{width}x{height}", "colorScheme": scheme}
    if is_precise(accuracy_m):
        params["center"] = point
        params["z"] = str(_ZOOM)
        params["annotations"] = _json([{"point": point, "markerStyle": "dot"}])
    else:
        # The snapshot fits the map to the circle.
        params["center"] = "auto"
        params["overlays"] = _json(
            [
                {
                    "type": "circle",
                    "center": point,
                    "radius": accuracy_m,
                    "strokeColor": _OVERLAY_COLOR,
                    "lineWidth": 2,
                }
            ]
        )
    params["teamId"] = maps.team_id
    params["keyId"] = maps.key_id
    query = "&".join(f"{name}={quote(value, safe=',')}" for name, value in params.items())
    path_and_query = f"{SNAPSHOT_PATH}?{query}"
    try:
        signature = sign_snapshot_path(maps, path_and_query)
    except (ValueError, TypeError):
        msg = "could not sign the snapshot URL"
        raise MapsError(msg) from None
    return f"{SNAPSHOT_HOST}{path_and_query}&signature={signature}"


def _json(value: object) -> str:
    return json.dumps(value, separators=(",", ":"))
