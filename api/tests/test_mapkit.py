"""Signing for Apple's map services."""

from __future__ import annotations

import base64

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature

from crosstune.places import mapkit
from crosstune.places.maps import AppleMaps


def test_snapshot_signature_is_raw_r_s_over_sha256_base64url() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    maps = AppleMaps(team_id="TEAM123456", key_id="KEY1234567", private_key=pem)
    path = "/api/v1/snapshot?center=1.0,2.0&teamId=TEAM123456&keyId=KEY1234567"

    signature = mapkit.sign_snapshot_path(maps, path)

    assert "=" not in signature
    raw = base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4))
    assert len(raw) == 64
    der = encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big"))
    key.public_key().verify(der, path.encode(), ec.ECDSA(hashes.SHA256()))
