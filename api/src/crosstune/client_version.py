"""Which client build is calling, and whether it is below the supported floor."""

import re
from collections.abc import Mapping
from dataclasses import dataclass

CLIENT_VERSION_HEADER = "X-Client-Version"
CLIENT_PLATFORM_HEADER = "X-Client-Platform"
APPLE_PLATFORMS: frozenset[str] = frozenset({"macos", "ios"})
KNOWN_PLATFORMS: frozenset[str] = APPLE_PLATFORMS | {"web"}

type Version = tuple[int, int, int]

# ASCII digits only: `\d` would also accept digits from other scripts. Nine digits a part
# keeps `int()` cheap and the text within the `client_versions` column.
_VERSION = re.compile(r"[0-9]{1,9}(\.[0-9]{1,9}){0,2}")


@dataclass(frozen=True)
class ClientVersion:
    """A client's platform and version, as it reported them."""

    platform: str
    text: str
    version: Version


def parse_version(text: str | None) -> Version | None:
    """Parse one to three dot-separated integers, padded with zeros.

    Args:
        text: The version string, such as `1.10` or `2.0.1`.

    Returns:
        The `(major, minor, patch)` tuple, or None when the text is not a version.
    """
    if text is None or not _VERSION.fullmatch(text):
        return None
    major, minor, patch = [*map(int, text.split(".")), 0, 0][:3]
    return (major, minor, patch)


def client_version(headers: Mapping[str, str]) -> ClientVersion | None:
    """Read the calling client from the request headers.

    Args:
        headers: The request headers.

    Returns:
        The client, or None unless it names a known platform and a version that parses.
    """
    platform = headers.get(CLIENT_PLATFORM_HEADER)
    text = headers.get(CLIENT_VERSION_HEADER, "")
    version = parse_version(text)
    if platform not in KNOWN_PLATFORMS or version is None:
        return None
    return ClientVersion(platform, text, version)


def is_blocked(client: ClientVersion | None, apple_min: Version | None) -> bool:
    """Whether an Apple client is below the minimum supported version.

    Args:
        client: The calling client, if it identified itself.
        apple_min: The Apple floor, or None when no floor is set.

    Returns:
        True only for an Apple client whose version is below the floor.
    """
    return (
        client is not None
        and apple_min is not None
        and client.platform in APPLE_PLATFORMS
        and client.version < apple_min
    )
