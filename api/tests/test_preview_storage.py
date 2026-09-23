"""Seeding a pull request's audio from development, and removing it at teardown."""

from __future__ import annotations

import time
import uuid
from typing import TYPE_CHECKING
from unittest.mock import Mock

import pytest

from crosstune.ops import local_storage, preview_storage
from crosstune.storage.r2 import R2Store
from tests.fakes import FakeObjectStore

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


@pytest.mark.parametrize("prefix", ["", "pr-1", "pr-/", "pr-1/u/", "x/"])
async def test_teardown_refuses_anything_but_a_pr_prefix(prefix: str) -> None:
    store = FakeObjectStore()
    store.put_bytes("pr-1/u/r/playback.m4a", b"a", "audio/mp4")
    with pytest.raises(ValueError, match="pull request"):
        await preview_storage.teardown(store, prefix)
    assert store.keys() == ["pr-1/u/r/playback.m4a"]


@pytest.mark.parametrize("prefix", ["", "pr-1", "x/"])
def test_seed_refuses_anything_but_a_pr_prefix(prefix: str) -> None:
    untouchable = Mock(side_effect=AssertionError("no request may be made"))
    client = Mock(get_paginator=untouchable, get_object=untouchable, upload_fileobj=untouchable)
    with pytest.raises(ValueError, match="pull request"):
        preview_storage.seed(client, "src", client, "dst", prefix)
    untouchable.assert_not_called()


def test_main_refuses_a_bad_pr_name_before_any_request(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    with pytest.raises(ValueError, match="pull request"):
        preview_storage.main(["teardown", ""])


def test_main_names_a_missing_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CLOUDFLARE_ACCOUNT_ID", raising=False)
    with pytest.raises(SystemExit, match="CLOUDFLARE_ACCOUNT_ID"):
        preview_storage.main(["teardown", "pr-44"])


def test_main_seed_names_a_missing_dev_read_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CLOUDFLARE_ACCOUNT_ID", "acct")
    monkeypatch.setenv("STORAGE_ACCESS_KEY_ID_PREVIEW", "preview-key")
    monkeypatch.setenv("STORAGE_SECRET_ACCESS_KEY_PREVIEW", "preview-secret")
    monkeypatch.delenv("STORAGE_READ_ACCESS_KEY_ID_DEVELOPMENT", raising=False)
    monkeypatch.delenv("STORAGE_READ_SECRET_ACCESS_KEY_DEVELOPMENT", raising=False)
    with pytest.raises(SystemExit, match="STORAGE_READ_ACCESS_KEY_ID_DEVELOPMENT"):
        preview_storage.main(["seed", "pr-1"])


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


def test_seed_recopies_an_object_whose_size_changed(
    rustfs: S3Client, two_buckets: tuple[str, str]
) -> None:
    source, target = two_buckets
    rustfs.put_object(Bucket=source, Key="u/r/upload", Body=b"abc", ContentType="audio/webm")
    preview_storage.seed(rustfs, source, rustfs, target, "pr-7/")
    rustfs.put_object(Bucket=source, Key="u/r/upload", Body=b"abcdef", ContentType="audio/webm")
    assert preview_storage.seed(rustfs, source, rustfs, target, "pr-7/") == 1
    assert rustfs.get_object(Bucket=target, Key="pr-7/u/r/upload")["Body"].read() == b"abcdef"


def test_seed_recopies_a_same_size_object_rewritten_since_the_copy(
    rustfs: S3Client, two_buckets: tuple[str, str]
) -> None:
    source, target = two_buckets
    rustfs.put_object(Bucket=source, Key="u/r/upload", Body=b"abc", ContentType="audio/webm")
    preview_storage.seed(rustfs, source, rustfs, target, "pr-7/")
    time.sleep(0.01)
    rustfs.put_object(Bucket=source, Key="u/r/upload", Body=b"xyz", ContentType="audio/webm")
    assert preview_storage.seed(rustfs, source, rustfs, target, "pr-7/") == 1
    assert rustfs.get_object(Bucket=target, Key="pr-7/u/r/upload")["Body"].read() == b"xyz"
    assert preview_storage.seed(rustfs, source, rustfs, target, "pr-7/") == 0
