#!/usr/bin/env python3
"""Fail when the app's Info.plist lacks a key the shipped app depends on.

Usage: info_plist.py check PATH

iOS ends an app that asks for a permission without its purpose string, and starts no Live
Activity without `NSSupportsLiveActivities`. Neither fails a build or a test, and Xcode can
drop keys when it rewrites the file, so this check runs with the linters.
"""

from __future__ import annotations

import argparse
import plistlib
import sys
from pathlib import Path
from xml.parsers.expat import ExpatError

# Each permission the app requests, by the key whose text the system shows in its prompt
PURPOSE_STRING_KEYS = (
    "NSAppleMusicUsageDescription",
    "NSCameraUsageDescription",
    "NSLocationUsageDescription",
    "NSLocationWhenInUseUsageDescription",
    "NSMicrophoneUsageDescription",
)

# Boolean keys and the value each must hold
REQUIRED_FLAGS = {
    # Answers App Store Connect's export compliance question for every build
    "ITSAppUsesNonExemptEncryption": False,
    "NSSupportsLiveActivities": True,
}


def problems(info: dict[str, object]) -> list[str]:
    """List every required key that the Info.plist contents lack or hold a wrong value for.

    Args:
        info: The parsed Info.plist.

    Returns:
        list[str]: One message per problem, empty when every key is right.
    """
    found: list[str] = []
    for key in PURPOSE_STRING_KEYS:
        value = info.get(key)
        if not isinstance(value, str) or not value.strip():
            found.append(f"{key} must be a non-empty purpose string, found {value!r}")
    for key, expected in REQUIRED_FLAGS.items():
        value = info.get(key)
        if value is not expected:
            found.append(f"{key} must be {expected}, found {value!r}")
    return found


def check(path: Path) -> int:
    """Print each problem in the Info.plist at `path`.

    Args:
        path: The Info.plist to check.

    Returns:
        int: 0 when every required key is right, else 1.
    """
    try:
        with path.open("rb") as file:
            info = plistlib.load(file)
    except (OSError, ValueError, ExpatError, plistlib.InvalidFileException) as error:
        print(f"{path}: cannot read as a property list: {error}", file=sys.stderr)
        return 1
    if not isinstance(info, dict):
        print(
            f"{path}: expected a dictionary at the top level, found {type(info).__name__}",
            file=sys.stderr,
        )
        return 1
    found = problems(info)
    for problem in found:
        print(f"{path}: {problem}", file=sys.stderr)
    return 1 if found else 0


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
    check_parser = commands.add_parser("check", help="check the Info.plist at PATH")
    check_parser.add_argument("path", type=Path)
    arguments = parser.parse_args(argv)
    return check(arguments.path)


if __name__ == "__main__":
    sys.exit(main())
