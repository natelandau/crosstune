"""A store confined to one key prefix of a shared bucket."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

from crosstune.storage.prefixed import PrefixedStore
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from pathlib import Path

    from crosstune.storage.store import ObjectStore

pytestmark = pytest.mark.anyio


def pair() -> tuple[FakeObjectStore, PrefixedStore]:
    bucket = FakeObjectStore()
    return bucket, PrefixedStore(bucket, "pr-6/")


def test_is_an_object_store() -> None:
    _, scoped = pair()
    store: ObjectStore = scoped
    assert store is scoped


def test_rejects_a_prefix_without_a_trailing_slash() -> None:
    with pytest.raises(ValueError, match="end in /"):
        PrefixedStore(FakeObjectStore(), "pr-6")


def test_rejects_an_empty_prefix() -> None:
    with pytest.raises(ValueError, match="end in /"):
        PrefixedStore(FakeObjectStore(), "")


def test_presigned_urls_name_the_physical_key() -> None:
    bucket, scoped = pair()
    scoped.presign_put("u/r/upload", "audio/mp4", 5, 60)
    scoped.presign_get("u/r/playback.m4a", 60)
    assert bucket.presigned == [("put", "pr-6/u/r/upload"), ("get", "pr-6/u/r/playback.m4a")]


async def test_object_operations_stay_under_the_prefix(tmp_path: Path) -> None:
    bucket, scoped = pair()
    source = tmp_path / "a"
    source.write_bytes(b"abc")
    assert await scoped.upload(source, "u/r/upload", "audio/mp4") == 3
    assert bucket.keys() == ["pr-6/u/r/upload"]
    info = await scoped.head("u/r/upload")
    assert info is not None
    assert info.size == 3
    await scoped.copy("u/r/upload", "u/r/playback.m4a")
    out = tmp_path / "b"
    await scoped.download("u/r/playback.m4a", out)
    assert out.read_bytes() == b"abc"
    await scoped.delete("u/r/upload")
    assert bucket.keys() == ["pr-6/u/r/playback.m4a"]
    await scoped.delete_prefix("u/")
    assert bucket.keys() == []


async def test_list_keys_returns_logical_keys() -> None:
    bucket, scoped = pair()
    bucket.put_bytes("pr-6/u1/r1/a", b"x", "audio/mp4")
    bucket.put_bytes("pr-6/u2/r1/a", b"x", "audio/mp4")
    assert await scoped.list_keys() == ["u1/r1/a", "u2/r1/a"]
    assert await scoped.list_keys("u1/") == ["u1/r1/a"]


async def test_sibling_prefixes_are_never_listed_or_deleted() -> None:
    bucket = FakeObjectStore()
    bucket.put_bytes("pr-6/u1/r1/a", b"x", "audio/mp4")
    bucket.put_bytes("pr-60/u1/r1/a", b"x", "audio/mp4")
    bucket.put_bytes("u1/r1/a", b"x", "audio/mp4")
    scoped = PrefixedStore(bucket, "pr-6/")
    assert await scoped.list_keys() == ["u1/r1/a"]
    await scoped.delete_prefix("u1/")
    assert bucket.keys() == ["pr-60/u1/r1/a", "u1/r1/a"]
