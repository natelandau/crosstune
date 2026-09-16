"""Presigned URLs from the R2 store, and the in-memory fake the API tests rely on."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from botocore.stub import Stubber

from crosstune.storage.r2 import R2Store
from crosstune.storage.store import (
    ObjectStore,
    original_key,
    playback_key,
    upload_key,
    user_prefix,
)
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
    await fake.copy("a/b/upload", "a/b/original.m4a")
    assert fake.get_bytes("a/b/original.m4a") == fake.get_bytes("a/b/upload")

    await fake.delete("a/b/upload", "never-there")
    assert await fake.head("a/b/upload") is None
    await fake.delete_prefix("a/")
    assert fake.keys() == []


async def test_fake_store_lists_top_level_prefixes() -> None:
    fake = FakeObjectStore()
    fake.put_bytes("u1/r1/upload", b"a", "audio/mp4")
    fake.put_bytes("u1/r2/playback.m4a", b"b", "audio/mp4")
    fake.put_bytes("u2/r1/playback.m4a", b"c", "audio/mp4")
    assert await fake.list_prefixes() == ["u1/", "u2/"]


async def test_r2_list_prefixes_collects_every_page() -> None:
    r2 = store()
    stub = Stubber(r2._client)  # the client is the seam boto3 offers for stubbing
    stub.add_response(
        "list_objects_v2",
        {"IsTruncated": True, "NextContinuationToken": "t", "CommonPrefixes": [{"Prefix": "u1/"}]},
        {"Bucket": "crosstune-test", "Delimiter": "/"},
    )
    stub.add_response(
        "list_objects_v2",
        {"IsTruncated": False, "CommonPrefixes": [{"Prefix": "u2/"}]},
        {"Bucket": "crosstune-test", "Delimiter": "/", "ContinuationToken": "t"},
    )
    with stub:
        assert await r2.list_prefixes() == ["u1/", "u2/"]


async def test_r2_copy_never_names_a_storage_class() -> None:
    r2 = store()
    stub = Stubber(r2._client)  # the client is the seam boto3 offers for stubbing
    # Stubber rejects any parameter beyond the expected ones, so a StorageClass would fail here.
    stub.add_response(
        "copy_object",
        {},
        {
            "Bucket": "crosstune-test",
            "Key": "u/r/original.wav",
            "CopySource": {"Bucket": "crosstune-test", "Key": "u/r/upload"},
        },
    )
    with stub:
        await r2.copy("u/r/upload", "u/r/original.wav")
