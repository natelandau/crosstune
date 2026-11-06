#!/usr/bin/env python3
"""Delete Xcode's DerivedData folders of Crosstune checkouts that no longer exist.

Usage: derived_data.py prune

Xcode never deletes the folder of a removed worktree, and each holds gigabytes. Only
`Crosstune-*` folders are candidates, so the caches every project shares stay.
"""

from __future__ import annotations

import argparse
import plistlib
import shutil
import sys
from pathlib import Path
from xml.parsers.expat import ExpatError

DERIVED_DATA = Path.home() / "Library/Developer/Xcode/DerivedData"


def workspace_path(info: Path) -> str:
    """Read the project path Xcode recorded for a DerivedData folder.

    Args:
        info: The folder's `info.plist`.

    Returns:
        str: The recorded `WorkspacePath`, empty when the file holds none or does not parse.
    """
    try:
        with info.open("rb") as file:
            data = plistlib.load(file)
    except (OSError, ValueError, ExpatError, plistlib.InvalidFileException):
        return ""
    value = data.get("WorkspacePath", "") if isinstance(data, dict) else ""
    return value if isinstance(value, str) else ""


def prune(root: Path) -> None:
    """Delete each `Crosstune-*` folder under `root` whose recorded project is gone.

    Args:
        root: Xcode's DerivedData folder.
    """
    if not root.is_dir():
        return
    for folder in sorted(root.glob("Crosstune-*")):
        info = folder / "info.plist"
        # A folder without a recorded project may still be in use, so only a missing project counts.
        if not info.is_file():
            continue
        project = workspace_path(info)
        if project and not Path(project).exists():
            if folder.is_symlink():
                folder.unlink()
            else:
                shutil.rmtree(folder)
            print(f"removed {folder.name} ({project})")


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
    commands.add_parser("prune", help="delete the folders of checkouts that no longer exist")
    parser.parse_args(argv)
    prune(DERIVED_DATA)
    return 0


if __name__ == "__main__":
    sys.exit(main())
