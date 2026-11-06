"""Tests for the Swift package folder every checkout shares."""

from pathlib import Path

import pytest

import source_packages


def checkout(root: Path, name: str, resolved: str | None) -> Path:
    path = root / name
    (path / "apple" / "CrosstuneKit").mkdir(parents=True)
    if resolved is not None:
        (path / "apple" / source_packages.RESOLVED).write_text(resolved)
    return path


class FetchError(Exception):
    """A fetch that failed partway."""


class Fetcher:
    """Record each fetch and leave a folder behind, as xcodebuild does."""

    def __init__(self) -> None:
        self.targets: list[Path] = []

    def __call__(self, _apple: Path, target: Path) -> None:
        self.targets.append(target)
        (target / "checkouts").mkdir(parents=True)


def test_checkouts_with_the_same_pins_share_a_folder(tmp_path):
    cache = tmp_path / "cache"
    first = checkout(tmp_path, "first", "pins")
    second = checkout(tmp_path, "second", "pins")
    other = checkout(tmp_path, "other", "other pins")

    def folder(path: Path) -> Path:
        return source_packages.folder(cache=cache, apple=path / "apple")

    assert folder(first) == folder(second)
    assert folder(first) != folder(other)


def test_resolve_fetches_once_and_marks_the_folder_complete(tmp_path):
    cache = tmp_path / "cache"
    apple = checkout(tmp_path, "main", "pins") / "apple"
    fetcher = Fetcher()

    first = source_packages.resolve(cache=cache, apple=apple, fetcher=fetcher)
    second = source_packages.resolve(cache=cache, apple=apple, fetcher=fetcher)

    assert first == second
    assert fetcher.targets == [first]
    assert (first / source_packages.COMPLETE).is_file()


def test_resolve_starts_over_in_a_folder_a_failed_fetch_left(tmp_path):
    cache = tmp_path / "cache"
    apple = checkout(tmp_path, "main", "pins") / "apple"
    target = source_packages.folder(cache=cache, apple=apple)
    (target / "partial").mkdir(parents=True)
    fetcher = Fetcher()

    source_packages.resolve(cache=cache, apple=apple, fetcher=fetcher)

    assert fetcher.targets == [target]
    assert not (target / "partial").exists()


def test_a_failed_fetch_leaves_the_folder_unmarked(tmp_path):
    cache = tmp_path / "cache"
    apple = checkout(tmp_path, "main", "pins") / "apple"

    def fail(_apple: Path, target: Path) -> None:
        target.mkdir(parents=True)
        raise FetchError

    with pytest.raises(FetchError):
        source_packages.resolve(cache=cache, apple=apple, fetcher=fail)

    assert not (
        source_packages.folder(cache=cache, apple=apple) / source_packages.COMPLETE
    ).exists()


def test_prune_deletes_only_folders_no_checkout_pins(tmp_path, capsys):
    cache = tmp_path / "cache"
    kept = checkout(tmp_path, "kept", "pins")
    unpinned = checkout(tmp_path, "unpinned", None)
    wanted = source_packages.resolve(cache=cache, apple=kept / "apple", fetcher=Fetcher())
    stale = cache / "0123456789ab"
    (stale / "artifacts").mkdir(parents=True)
    (stale / "artifacts" / "framework").write_bytes(b"x" * 4096)

    freed = source_packages.prune(cache=cache, checkouts=[kept, unpinned])

    assert wanted.is_dir()
    assert not stale.exists()
    assert (cache / ".lock").is_file()
    assert freed >= 4096
    assert capsys.readouterr().out == "removed Swift packages 0123456789ab\n"


def test_prune_without_a_cache_does_nothing(tmp_path):
    assert source_packages.prune(cache=tmp_path / "cache", checkouts=[]) == 0


def test_size_counts_nested_files_and_skips_links(tmp_path):
    (tmp_path / "a" / "b").mkdir(parents=True)
    (tmp_path / "a" / "b" / "file").write_bytes(b"x" * 4096)
    (tmp_path / "link").symlink_to(tmp_path / "a" / "b" / "file")
    (tmp_path / "dirlink").symlink_to(tmp_path / "a")

    assert source_packages.size(tmp_path) == source_packages.size(tmp_path / "a") >= 4096
