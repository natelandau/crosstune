"""Presigned URLs from the R2 store, and the in-memory fake the API tests rely on."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from crosstune.storage.r2 import R2Store
from crosstune.storage.store import ObjectStore, original_key, playback_key, upload_key, user_prefix
from tests.fakes import FakeObjectStore

pytestmark = pytest.mark.anyio


def store() -> R2Store:
    return R2Store(
        account_id="acct",
        bucket="crosstune-test",
        access_key_id="test-access-key",  # gitleaks:allow -- fixture, not a credential
        secret_access_key="test-secret",  # gitleaks:allow -- fixture, not a credential
    )


def test_presigned_put_pins_bucket_key_and_content_type() -> None:
    url = store().presign_put("u/r/upload", "audio/mp4", expires_in=3600)
    parts = urlparse(url)
    assert parts.hostname == "acct.r2.cloudflarestorage.com"
    assert parts.path == "/crosstune-test/u/r/upload"
    query = parse_qs(parts.query)
    assert query["X-Amz-Expires"] == ["3600"]
    assert "content-type" in query["X-Amz-SignedHeaders"][0]


def test_presigned_get_is_a_plain_get() -> None:
    url = store().presign_get("u/r/playback.m4a", expires_in=60)
    query = parse_qs(urlparse(url).query)
    assert query["X-Amz-SignedHeaders"] == ["host"]


def test_keys_share_the_user_prefix() -> None:
    assert upload_key("u1", "r1") == "u1/r1/upload"
    assert playback_key("u1", "r1") == "u1/r1/playback.m4a"
    assert original_key("u1", "r1", "audio/webm") == "u1/r1/original.webm"
    assert original_key("u1", "r1", "audio/x-something") == "u1/r1/original.bin"
    assert user_prefix("u1") == "u1/"


def test_fake_store_satisfies_the_protocol() -> None:
    # The annotation is the assertion: the type checker rejects a fake that has
    # drifted from ObjectStore, which the API tests would otherwise not notice.
    store: ObjectStore = FakeObjectStore()
    assert store is not None


async def test_fake_store_round_trips(tmp_path) -> None:
    fake = FakeObjectStore()
    fake.put_bytes("a/b/upload", b"abc", "audio/mp4")
    info = await fake.head("a/b/upload")
    assert info is not None
    assert (info.size, info.content_type) == (3, "audio/mp4")
    assert await fake.head("missing") is None

    target = tmp_path / "down"
    await fake.download("a/b/upload", target)
    assert target.read_bytes() == b"abc"

    source = tmp_path / "up"
    source.write_bytes(b"xyz1")
    assert await fake.upload(source, "a/b/playback.m4a", "audio/mp4") == 4
    await fake.copy("a/b/upload", "a/b/original.m4a", infrequent_access=True)
    assert fake.storage_class("a/b/original.m4a") == "STANDARD_IA"

    await fake.delete("a/b/upload", "never-there")
    assert await fake.head("a/b/upload") is None
    await fake.delete_prefix("a/")
    assert fake.keys() == []
