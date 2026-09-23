"""The S3 calls the API makes, against a real RustFS. This is the gate for using it locally."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx2
import pytest

from crosstune.ops import local_storage
from crosstune.storage.r2 import R2Store

if TYPE_CHECKING:
    from pathlib import Path

    from types_boto3_s3 import S3Client

pytestmark = pytest.mark.anyio

ORIGIN = "http://localhost:5173"


def store(bucket: str) -> R2Store:
    return R2Store(
        endpoint_url=local_storage.ENDPOINT,
        bucket=bucket,
        access_key_id=local_storage.ACCESS_KEY,
        secret_access_key=local_storage.SECRET_KEY,
    )


async def test_browser_upload_and_download_through_presigned_urls(rustfs_bucket: str) -> None:
    r2 = store(rustfs_bucket)
    put_url = r2.presign_put("u/r/upload", "audio/mp4", expires_in=600)
    async with httpx2.AsyncClient() as http:
        preflight = await http.options(
            put_url,
            headers={
                "Origin": ORIGIN,
                "Access-Control-Request-Method": "PUT",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        assert preflight.headers.get("access-control-allow-origin") in {ORIGIN, "*"}
        put = await http.put(
            put_url, content=b"audio", headers={"Content-Type": "audio/mp4", "Origin": ORIGIN}
        )
        assert put.status_code == 200
        get = await http.get(r2.presign_get("u/r/upload", expires_in=600))
        assert get.content == b"audio"


async def test_head_copy_download_and_upload(rustfs_bucket: str, tmp_path: Path) -> None:
    r2 = store(rustfs_bucket)
    source = tmp_path / "in.m4a"
    source.write_bytes(b"abc")
    assert await r2.upload(source, "u/r/playback.m4a", "audio/mp4") == 3
    info = await r2.head("u/r/playback.m4a")
    assert info is not None
    assert (info.size, info.content_type) == (3, "audio/mp4")
    assert await r2.head("u/r/missing") is None
    await r2.copy("u/r/playback.m4a", "u/r/original.m4a")
    target = tmp_path / "out.m4a"
    await r2.download("u/r/original.m4a", target)
    assert target.read_bytes() == b"abc"


async def test_listing_and_batch_deletes(rustfs_bucket: str, rustfs: S3Client) -> None:
    r2 = store(rustfs_bucket)
    for key in ("u1/r1/a", "u1/r2/a", "u2/r1/a"):
        rustfs.put_object(Bucket=rustfs_bucket, Key=key, Body=b"x")
    assert await r2.list_prefixes() == ["u1/", "u2/"]
    await r2.delete("u2/r1/a", "u2/r1/never-there")
    await r2.delete_prefix("u1/r1/")
    remaining = rustfs.list_objects_v2(Bucket=rustfs_bucket).get("Contents", [])
    assert [obj["Key"] for obj in remaining] == ["u1/r2/a"]


def test_setup_creates_both_buckets_and_is_repeatable(rustfs: S3Client) -> None:
    assert local_storage.main(["setup"]) == 0
    assert local_storage.main(["setup"]) == 0
    names = {bucket["Name"] for bucket in rustfs.list_buckets()["Buckets"]}
    assert set(local_storage.BUCKETS) <= names


def test_reset_empties_only_the_named_bucket(rustfs: S3Client) -> None:
    local_storage.main(["setup"])
    rustfs.put_object(Bucket=local_storage.E2E_BUCKET, Key="u/r/a", Body=b"x")
    rustfs.put_object(Bucket=local_storage.LOCAL_BUCKET, Key="keep/me", Body=b"x")
    assert local_storage.main(["reset", local_storage.E2E_BUCKET]) == 0
    assert "Contents" not in rustfs.list_objects_v2(Bucket=local_storage.E2E_BUCKET)
    kept = rustfs.list_objects_v2(Bucket=local_storage.LOCAL_BUCKET)["Contents"]
    assert "keep/me" in [obj["Key"] for obj in kept]
    rustfs.delete_object(Bucket=local_storage.LOCAL_BUCKET, Key="keep/me")


def test_ls_and_get(rustfs: S3Client, tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    local_storage.main(["setup"])
    rustfs.put_object(Bucket=local_storage.LOCAL_BUCKET, Key="ls-test/r/playback.m4a", Body=b"abc")
    assert local_storage.main(["ls", "ls-test/"]) == 0
    assert "ls-test/r/playback.m4a" in capsys.readouterr().out
    dest = tmp_path / "got.m4a"
    assert local_storage.main(["get", "ls-test/r/playback.m4a", str(dest)]) == 0
    assert dest.read_bytes() == b"abc"
    rustfs.delete_object(Bucket=local_storage.LOCAL_BUCKET, Key="ls-test/r/playback.m4a")


def test_every_command_refuses_a_bucket_it_does_not_own() -> None:
    with pytest.raises(SystemExit):
        local_storage.main(["reset", "crosstune-recordings-dev"])


async def test_listing_below_a_prefix(rustfs_bucket: str, rustfs: S3Client) -> None:
    for key in ("u1/r1/a", "u1/r2/a", "u2/r1/a"):
        rustfs.put_object(Bucket=rustfs_bucket, Key=key, Body=b"x")
    assert await store(rustfs_bucket).list_prefixes("u1/") == ["u1/r1/", "u1/r2/"]
