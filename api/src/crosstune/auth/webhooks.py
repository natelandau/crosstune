"""Standard Webhooks signature verification, as used by Clerk through Svix."""

from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import time
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Mapping

TIMESTAMP_TOLERANCE_SECONDS = 300


def verify_svix_signature(
    secret: str, headers: Mapping[str, str], body: bytes, now: float | None = None
) -> bool:
    """True when any v1 signature matches and the timestamp is within tolerance."""
    msg_id = headers.get("svix-id")
    timestamp = headers.get("svix-timestamp")
    signatures = headers.get("svix-signature", "")
    if not msg_id or not timestamp or not signatures:
        return False
    try:
        ts = int(timestamp)
    except ValueError:
        return False
    if abs((now or time.time()) - ts) > TIMESTAMP_TOLERANCE_SECONDS:
        return False

    try:
        key = base64.b64decode(secret.removeprefix("whsec_"))
    except binascii.Error:
        # A secret that is not base64 can sign nothing; refuse rather than crash.
        return False
    signed = f"{msg_id}.{ts}.".encode() + body
    expected = base64.b64encode(hmac.new(key, signed, hashlib.sha256).digest())
    for entry in signatures.split():
        version, _, candidate = entry.partition(",")
        # compare_digest raises on non-ASCII str; encode with replace, which never raises
        # for any str, so an attacker-controlled header compares as bytes and fails to match.
        candidate_bytes = candidate.encode("utf-8", "replace")
        if version == "v1" and hmac.compare_digest(candidate_bytes, expected):
            return True
    return False
