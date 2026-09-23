"""Presigned URLs from the R2 store, and the in-memory fake the API tests rely on."""

from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest
from botocore.stub import Stubber

from crosstune.storage.r2 import ObjectDeleteError, R2Store, s3_client
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
        endpoint_url="https://acct.r2.cloudflarestorage.com",
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


def local_store(browser_endpoint_url: str = "") -> R2Store:
    return R2Store(
        endpoint_url="http://localhost:9000",
        bucket="crosstune-local",
        access_key_id="crosstune",  # gitleaks:allow -- fixture, not a credential
        secret_access_key="crosstune-local-secret",  # gitleaks:allow -- fixture, not a credential
        browser_endpoint_url=browser_endpoint_url,
    )


def test_presign_put_rewritten_for_a_relative_browser_endpoint() -> None:
    url = local_store("/storage").presign_put("u/r/upload", "audio/mp4", expires_in=600)
    parts = urlparse(url)
    assert (parts.scheme, parts.netloc) == ("", "")
    assert parts.path == "/storage/crosstune-local/u/r/upload"
    assert parse_qs(parts.query)["X-Amz-Expires"] == ["600"]


def test_presign_get_rewritten_for_a_relative_browser_endpoint() -> None:
    url = local_store("/storage").presign_get("u/r/playback.m4a", expires_in=60)
    parts = urlparse(url)
    assert parts.path == "/storage/crosstune-local/u/r/playback.m4a"
    assert parse_qs(parts.query)["X-Amz-SignedHeaders"] == ["host"]


def test_presign_rewritten_for_an_absolute_browser_endpoint() -> None:
    url = local_store("https://example.test/storage").presign_put(
        "u/r/upload", "audio/mp4", expires_in=600
    )
    parts = urlparse(url)
    assert (parts.scheme, parts.netloc) == ("https", "example.test")
    assert parts.path == "/storage/crosstune-local/u/r/upload"


def test_browser_endpoint_trailing_slash_is_stripped() -> None:
    url = local_store("/storage/").presign_get("u/r/playback.m4a", expires_in=60)
    assert urlparse(url).path == "/storage/crosstune-local/u/r/playback.m4a"


def test_presign_without_a_browser_endpoint_is_unchanged() -> None:
    url = local_store().presign_get("u/r/playback.m4a", expires_in=60)
    parts = urlparse(url)
    assert parts.hostname == "localhost"
    assert parts.path == "/crosstune-local/u/r/playback.m4a"


def test_rewrite_for_browser_preserves_the_query_exactly() -> None:
    # A crafted already-signed URL, not a live presign, so nothing about the
    # signature's timing can make the comparison flaky.
    r2 = local_store("/storage")
    signed = (
        "http://localhost:9000/crosstune-local/u/r/upload?X-Amz-Signature=abc&X-Amz-Expires=600"
    )
    rewritten = "/storage/crosstune-local/u/r/upload?X-Amz-Signature=abc&X-Amz-Expires=600"
    assert r2._rewrite_for_browser(signed) == rewritten


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


def test_s3_client_signs_for_auto_on_r2_and_us_east_1_elsewhere() -> None:
    r2 = s3_client("https://acct.r2.cloudflarestorage.com", "k", "s")
    local = s3_client("http://localhost:9000", "k", "s")
    assert r2.meta.region_name == "auto"
    assert local.meta.region_name == "us-east-1"


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


async def test_fake_store_lists_every_key() -> None:
    fake = FakeObjectStore()
    fake.put_bytes("u2/r1/playback.m4a", b"c", "audio/mp4")
    fake.put_bytes("u1/r1/upload", b"a", "audio/mp4")
    fake.put_bytes("u1/r2/playback.m4a", b"b", "audio/mp4")
    assert await fake.list_keys() == ["u1/r1/upload", "u1/r2/playback.m4a", "u2/r1/playback.m4a"]
    assert await fake.list_keys("u1/r2/") == ["u1/r2/playback.m4a"]
    assert await fake.list_keys("u3/") == []


async def test_r2_list_keys_collects_every_page() -> None:
    r2 = store()
    stub = Stubber(r2._client)  # the client is the seam boto3 offers for stubbing
    stub.add_response(
        "list_objects_v2",
        {"IsTruncated": True, "NextContinuationToken": "t", "Contents": [{"Key": "u1/r1/a"}]},
        {"Bucket": "crosstune-test"},
    )
    stub.add_response(
        "list_objects_v2",
        {"IsTruncated": False, "Contents": [{"Key": "u2/r1/a"}]},
        {"Bucket": "crosstune-test", "ContinuationToken": "t"},
    )
    with stub:
        assert await r2.list_keys() == ["u1/r1/a", "u2/r1/a"]


async def test_r2_list_keys_below_a_prefix() -> None:
    r2 = store()
    stub = Stubber(r2._client)  # the client is the seam boto3 offers for stubbing
    stub.add_response(
        "list_objects_v2",
        {"IsTruncated": False, "Contents": [{"Key": "u1/r1/a"}]},
        {"Bucket": "crosstune-test", "Prefix": "u1/"},
    )
    stub.add_response(
        "list_objects_v2", {"IsTruncated": False}, {"Bucket": "crosstune-test", "Prefix": "u9/"}
    )
    with stub:
        assert await r2.list_keys("u1/") == ["u1/r1/a"]
        assert await r2.list_keys("u9/") == []


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


async def test_r2_delete_raises_when_the_bucket_reports_a_key_it_kept() -> None:
    r2 = store()
    stub = Stubber(r2._client)  # the client is the seam boto3 offers for stubbing
    # A batch delete answers 200 even when some keys stay; only the body says so.
    stub.add_response(
        "delete_objects",
        {"Errors": [{"Key": "u/r/upload", "Code": "AccessDenied", "Message": "nope"}]},
        {
            "Bucket": "crosstune-test",
            "Delete": {"Objects": [{"Key": "u/r/upload"}, {"Key": "u/r/x"}], "Quiet": True},
        },
    )
    with stub, pytest.raises(ObjectDeleteError, match="1 of 2 objects were not deleted"):
        await r2.delete("u/r/upload", "u/r/x")
