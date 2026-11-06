#!/usr/bin/env python3
"""Delete the Apple build folders of every checkout that is not building now.

Usage: builds.py prune

Each checkout's builds hold tens of gigabytes. A checkout is busy while xcodebuild, a Swift
tool, or SourceKit-LSP holds a file open under its `apple/` folder, or while a script that
uses a build after xcodebuild exits holds a marker in IN_USE. A busy checkout keeps its
builds so no running build loses its files. Then delete the shared Swift package folders
that no checkout uses.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import source_packages

if TYPE_CHECKING:
    from collections.abc import Callable, Generator

# The signed Debug build `just apple::run` installs, apart from the unsigned `apple::build`.
RUN_DERIVED_DATA = "apple/.build/RunDerivedData"
# Only build products: archives, captures, and shots under apple/.build outlive a build.
BUILD_FOLDERS = (
    "apple/.build/DerivedData",
    RUN_DERIVED_DATA,
    "apple/CrosstuneKit/.build",
    "apple/Tools/.build",
)
# lsof matches each name as a case-sensitive prefix of the process name: `swift` covers
# swift-build, swift-test, swift-frontend, and swift-plugin-server.
BUILD_TOOLS = (
    "xcodebuild",
    "swift",
    "sourcekit",
    "SourceKitService",
    "SWBBuild",
    "XCBBuild",
    "clang",
    "ld",
)
# Holds one empty file per running script, named for its process ID. `in-use.sh` and
# `in_use()` write them.
IN_USE = Path("apple/.build/in-use")
GIGABYTE = 1_000_000_000


@dataclass(frozen=True)
class OpenFile:
    """A file, or a working folder, that a process holds open."""

    pid: int
    command: str
    path: str


def parse_lsof(output: str) -> list[OpenFile]:
    """Read the files of `lsof -F pcn` output, each tagged with the process that holds it.

    Args:
        output: Lines that each start with a field letter: `p` the process ID, `c` its name,
            `n` a file name.

    Returns:
        list[OpenFile]: One entry per file name.
    """
    files: list[OpenFile] = []
    pid = 0
    command = ""
    for line in output.splitlines():
        field, value = line[:1], line[1:]
        if field == "p":
            pid, command = int(value), ""
        elif field == "c":
            command = value
        elif field == "n" and value.startswith("/"):
            files.append(OpenFile(pid=pid, command=command, path=value))
    return files


def open_build_files() -> list[OpenFile]:
    """List every file the build tools hold open, working folders included."""
    selectors = [argument for tool in BUILD_TOOLS for argument in ("-c", tool)]
    # lsof exits 1 when no process matches, and warns about file systems it cannot read.
    result = subprocess.run(
        ["lsof", "-w", "-n", "-P", "-F", "pcn", *selectors],
        check=False,
        capture_output=True,
        text=True,
    )
    return parse_lsof(result.stdout)


def busy(*, checkout: Path, files: list[OpenFile]) -> OpenFile | None:
    """Find a build tool working in the checkout.

    Every worktree sits inside the main checkout, so only a path under the checkout's own
    `apple/` folder counts: the main checkout's `apple/` holds no worktree.

    Args:
        checkout: The checkout's top folder.
        files: Every file the build tools hold open.

    Returns:
        OpenFile | None: A file a build tool holds under the checkout, or None when it is idle.
    """
    apple = f"{checkout / 'apple'}"
    for file in files:
        if file.path == apple or file.path.startswith(f"{apple}/"):
            return file
    return None


def is_alive(pid: int) -> bool:
    """Report whether a process with this ID is running."""
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        pass
    return True


def marked(*, checkout: Path, alive: Callable[[int], bool] = is_alive) -> int | None:
    """Find a running script that marked the checkout's builds in use.

    A marker whose process is gone was left by a script that was killed, and is ignored.

    Args:
        checkout: The checkout's top folder.
        alive: Reports whether a process ID is running.

    Returns:
        int | None: The process ID of a running script, or None when no live marker exists.
    """
    folder = checkout / IN_USE
    if not folder.is_dir():
        return None
    for marker in sorted(folder.iterdir()):
        if marker.name.isdigit() and alive(int(marker.name)):
            return int(marker.name)
    return None


@contextlib.contextmanager
def in_use(apple: Path) -> Generator[None]:
    """Mark the checkout's builds in use until the block ends, so a prune keeps them.

    Args:
        apple: The checkout's Apple module.
    """
    folder = apple.parent / IN_USE
    folder.mkdir(parents=True, exist_ok=True)
    marker = folder / str(os.getpid())
    marker.touch()
    try:
        yield
    finally:
        marker.unlink(missing_ok=True)


def clean(checkout: Path) -> int:
    """Delete the checkout's build folders.

    Returns:
        int: The bytes deleted.
    """
    freed = 0
    for name in BUILD_FOLDERS:
        folder = checkout / name
        if folder.is_dir() and not folder.is_symlink():
            freed += source_packages.size(folder)
            shutil.rmtree(folder)
    return freed


def prune(
    *,
    checkouts: list[Path],
    files: list[OpenFile],
    cache: Path,
    alive: Callable[[int], bool] = is_alive,
) -> int:
    """Delete the builds of every idle checkout, then the package folders none of them uses.

    Args:
        checkouts: Every checkout of the repository.
        files: Every file the build tools hold open.
        cache: The folder that holds the shared Swift package folders.
        alive: Reports whether a process ID is running.

    Returns:
        int: The bytes deleted.
    """
    freed = 0
    for checkout in checkouts:
        holder = busy(checkout=checkout, files=files)
        if holder is not None:
            print(f"kept {checkout}: {holder.command} (pid {holder.pid}) is using it")
            continue
        script = marked(checkout=checkout, alive=alive)
        if script is not None:
            print(f"kept {checkout}: a script (pid {script}) is using its builds")
            continue
        removed = clean(checkout)
        if removed:
            print(f"removed {removed / GIGABYTE:.1f} GB of builds from {checkout}")
        freed += removed
    freed += source_packages.prune(cache=cache, checkouts=checkouts)
    print(f"freed {freed / GIGABYTE:.1f} GB")
    return freed


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
    commands.add_parser("prune", help="delete the builds of every checkout not building now")
    parser.parse_args(argv)
    prune(
        checkouts=source_packages.checkouts(source_packages.APPLE),
        files=open_build_files(),
        cache=source_packages.CACHE,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
