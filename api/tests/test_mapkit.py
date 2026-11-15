"""Signing for Apple's map services."""

from __future__ import annotations

import base64
from urllib.parse import parse_qsl, urlsplit

import pytest
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from crosstune.places import mapkit
from crosstune.places.maps import AppleMaps
from tests.helpers import ec_pem

HOUR = 3_600


def test_snapshot_signature_is_raw_r_s_over_sha256_base64url() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    maps = AppleMaps(team_id="TEAM123456", key_id="KEY1234567", private_key=ec_pem(key))
    path = "/api/v1/snapshot?center=1.0,2.0&teamId=TEAM123456&keyId=KEY1234567"

    signature = mapkit.sign_snapshot_path(maps, path)

    assert "=" not in signature
    raw = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
    assert len(raw) == 64
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    key.public_key().verify(der, path.encode(), ec.ECDSA(hashes.SHA256()))


def _signed_part(now: float) -> str:
    """A snapshot URL signed at `now`, without its signature, which differs on every signing."""
    maps = AppleMaps(
        team_id="TEAM123456",
        key_id="KEY1234567",
        private_key=ec_pem(),
        clock=lambda: now,
    )
    url = mapkit.snapshot_url(
        maps, lat=36.66, lon=-80.92, accuracy_m=None, width=120, height=90, scheme="dark"
    )
    return url.partition("&signature=")[0]


@pytest.mark.parametrize("seconds_into_hour", [0, 1, HOUR // 2, HOUR - 1])
def test_snapshot_url_expires_within_two_hours_and_holds_for_the_hour(
    seconds_into_hour: int,
) -> None:
    hour = 1_800_000_000 - 1_800_000_000 % HOUR
    signed_at = hour + seconds_into_hour

    signed = _signed_part(signed_at)

    expires = int(dict(parse_qsl(urlsplit(signed).query))["expires"])
    assert signed_at + HOUR < expires <= signed_at + 2 * HOUR
    # Signed again in the same hour, the URL is the same, so a browser reuses the cached image.
    assert _signed_part(hour + HOUR - 1) == signed
