"""Seeding a pull request's audio from development, and removing it at teardown."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest

from crosstune.ops import local_storage, preview_storage
from crosstune.storage.r2 import R2Store

if TYPE_CHECKING:
    from collections.abc import Iterator

    from types_boto3_s3 import S3Client

pytestmark = pytest.mark.anyio


@pytest.mark.parametrize("name", ["", "pr-", "pr-1/", "pr-1/..", "PR-1", "main", "pr-1a", " pr-1"])
def test_pr_prefix_refuses_anything_but_pr_number(name: str) -> None:
    with pytest.raises(ValueError, match="pull request"):
        preview_storage.pr_prefix(name)


def test_pr_prefix_of_a_pr_name() -> None:
    assert preview_storage.pr_prefix("pr-44") == "pr-44/"


def test_main_refuses_a_bad_pr_name_before_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    with pytest.raises(ValueError, match="pull request"):
        preview_storage.main(["teardown", ""])


def test_main_names_a_missing_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    with pytest.raises(SystemExit, match="CLOUDFLARE_ACCOUNT_ID"):
        preview_storage.main(["teardown", "pr-44"])


@pytest.fixture
def two_buckets(rustfs: S3Client) -> Iterator[tuple[str, str]]:
    names = (f"seed-src-{uuid.uuid4().hex[:10]}", f"seed-dst-{uuid.uuid4().hex[:10]}")
    for name in names:
        local_storage.ensure_bucket(rustfs, name)
    yield names
    for name in names:
        local_storage.empty_bucket(rustfs, name)
        rustfs.delete_bucket(Bucket=name)


def keys(client: S3Client, bucket: str) -> list[str]:
    return sorted(obj["Key"] for obj in client.list_objects_v2(Bucket=bucket).get("Contents", []))


def test_seed_copies_missing_objects_with_their_content_type(
    rustfs: S3Client, two_buckets: tuple[str, str]
) -> None:
    source, target = two_buckets
    rustfs.put_object(Bucket=source, Key="u/r/playback.m4a", Body=b"abc", ContentType="audio/mp4")
    rustfs.put_object(Bucket=source, Key="u/r/upload", Body=b"raw", ContentType="audio/webm")
    assert preview_storage.seed(rustfs, source, rustfs, target, "pr-7/") == 2
    assert keys(rustfs, target) == ["pr-7/u/r/playback.m4a", "pr-7/u/r/upload"]
    head = rustfs.head_object(Bucket=target, Key="pr-7/u/r/playback.m4a")
    assert head["ContentType"] == "audio/mp4"
    assert rustfs.head_object(Bucket=target, Key="pr-7/u/r/upload")["ContentType"] == "audio/webm"


def test_seed_again_copies_only_what_is_new(rustfs: S3Client, two_buckets: tuple[str, str]) -> None:
    source, target = two_buckets
    rustfs.put_object(Bucket=source, Key="u/r1/playback.m4a", Body=b"abc", ContentType="audio/mp4")
    preview_storage.seed(rustfs, source, rustfs, target, "pr-7/")
    rustfs.put_object(Bucket=source, Key="u/r2/playback.m4a", Body=b"def", ContentType="audio/mp4")
    assert preview_storage.seed(rustfs, source, rustfs, target, "pr-7/") == 1


async def test_teardown_leaves_a_longer_sibling_alone(
    rustfs: S3Client, two_buckets: tuple[str, str]
) -> None:
    _, bucket = two_buckets
    for key in ("pr-1/u/r/a", "pr-1/u/r/b", "pr-10/u/r/a", "pr-2/u/r/a"):
        rustfs.put_object(Bucket=bucket, Key=key, Body=b"x")
    store = R2Store(
        endpoint_url=local_storage.ENDPOINT,
        bucket=bucket,
        access_key_id=local_storage.ACCESS_KEY,
        secret_access_key=local_storage.SECRET_KEY,
    )
    await preview_storage.teardown(store, preview_storage.pr_prefix("pr-1"))
    assert keys(rustfs, bucket) == ["pr-10/u/r/a", "pr-2/u/r/a"]
