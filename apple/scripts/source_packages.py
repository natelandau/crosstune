#!/usr/bin/env python3
"""Keep one copy of the app's Swift packages for every checkout and worktree.

Usage: source_packages.py resolve [--apple PATH] | prune

Each xcodebuild DerivedData folder otherwise fetches its own copy of every package and binary
artifact, about 4 GB. The copy lives in a folder named for the hash of
`CrosstuneKit/Package.resolved`, so a branch that changes a dependency gets its own folder and
never rewrites the sources another checkout is compiling.

Two xcodebuilds that resolve into the same empty folder at once fail, so `resolve` fills a
folder under a lock and marks it complete. Once filled, a build's own resolution only reads
the sources and artifacts, so builds that share it run in parallel.

Runs on the system python3, with no dependencies, so CI can call it before the API's
environment exists.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

CACHE = Path.home() / "Library/Caches/crosstune/source-packages"
APPLE = Path(__file__).resolve().parent.parent
RESOLVED = Path("CrosstuneKit/Package.resolved")
COMPLETE = ".complete"
KEY_LENGTH = 12


def key(resolved: Path) -> str:
    """Name the package folder for a `Package.resolved` file.

    Args:
        resolved: The file that pins every package version.

    Returns:
        str: The start of the file's SHA-256 hash.
    """
    return hashlib.sha256(resolved.read_bytes()).hexdigest()[:KEY_LENGTH]


def folder(*, cache: Path, apple: Path) -> Path:
    """Find the package folder for the checkout whose Apple module is `apple`."""
    return cache / key(apple / RESOLVED)


@contextlib.contextmanager
def _lock(cache: Path) -> Generator[None]:
    """Hold an exclusive lock on the cache while a folder is filled or deleted."""
    cache.mkdir(parents=True, exist_ok=True)
    with (cache / ".lock").open("w") as file:
        try:
            fcntl.flock(file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            print("waiting for another checkout to fetch the Swift packages", file=sys.stderr)
            fcntl.flock(file, fcntl.LOCK_EX)
        yield


def fetch(apple: Path, target: Path) -> None:
    """Resolve the app's packages into `target` with xcodebuild."""
    subprocess.run(
        [
            str(apple / "scripts/scrub-env.sh"),
            "xcodebuild",
            "-resolvePackageDependencies",
            "-quiet",
            "-project",
            str(apple / "Crosstune.xcodeproj"),
            "-scheme",
            "Crosstune",
            "-derivedDataPath",
            str(apple / ".build/DerivedData"),
            "-clonedSourcePackagesDirPath",
            str(target),
        ],
        check=True,
        stdout=sys.stderr,
    )


def resolve(*, cache: Path, apple: Path, fetcher: Callable[[Path, Path], None] = fetch) -> Path:
    """Fill the checkout's package folder once, and return it.

    The folder records its own path, so it is filled in place, never renamed. A folder with
    no completion mark was left by a fetch that failed, and starts over.

    Args:
        cache: The folder that holds every package folder.
        apple: The checkout's Apple module.
        fetcher: Resolves the packages of `apple` into a folder.

    Returns:
        Path: The package folder.
    """
    target = folder(cache=cache, apple=apple)
    if (target / COMPLETE).is_file():
        return target
    with _lock(cache):
        if not (target / COMPLETE).is_file():
            shutil.rmtree(target, ignore_errors=True)
            fetcher(apple, target)
            (target / COMPLETE).touch()
    return target


def checkouts(cwd: Path) -> list[Path]:
    """List every checkout of the repository: the main checkout, then each worktree."""
    listing = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout
    return [
        Path(line.removeprefix("worktree "))
        for line in listing.splitlines()
        if line.startswith("worktree ")
    ]


def prune(*, cache: Path, checkouts: list[Path]) -> int:
    """Delete each package folder that no checkout's `Package.resolved` names.

    Args:
        cache: The folder that holds every package folder.
        checkouts: Every checkout of the repository.

    Returns:
        int: The bytes deleted.
    """
    if not cache.is_dir():
        return 0
    # A checkout whose branch predates CrosstuneKit has no Package.resolved and needs no folder.
    wanted = {
        key(path / "apple" / RESOLVED)
        for path in checkouts
        if (path / "apple" / RESOLVED).is_file()
    }
    freed = 0
    with _lock(cache):
        for entry in sorted(cache.iterdir()):
            if entry.name.startswith(".") or entry.name in wanted or not entry.is_dir():
                continue
            freed += size(entry)
            shutil.rmtree(entry)
            print(f"removed Swift packages {entry.name}")
    return freed


def size(path: Path) -> int:
    """Count the bytes the files under `path` hold on disk, links not followed."""
    total = 0
    pending = [path]
    # One lstat per entry: a build folder holds millions of files.
    while pending:
        with os.scandir(pending.pop()) as entries:
            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False):
                    total += entry.stat(follow_symlinks=False).st_blocks * 512
    return total


def main(argv: list[str] | None = None) -> int:
    """Run the subcommand the arguments name.

    Args:
        argv: The arguments, without the program name. Defaults to the process arguments.

    Returns:
        int: The exit status.
    """
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    commands = parser.add_subparsers(dest="command", required=True)
    resolve_parser = commands.add_parser(
        "resolve", help="fill a checkout's package folder and print its path"
    )
    resolve_parser.add_argument(
        "--apple",
        type=Path,
        default=APPLE,
        help="the checkout's apple/ folder; defaults to the one that holds this script",
    )
    commands.add_parser("prune", help="delete the package folders no checkout uses")
    args = parser.parse_args(argv)
    if args.command == "resolve":
        print(resolve(cache=CACHE, apple=args.apple.resolve()))
    else:
        prune(cache=CACHE, checkouts=checkouts(APPLE))
    return 0


if __name__ == "__main__":
    sys.exit(main())
