"""Client versions parse numerically, and only an Apple build below the floor is blocked."""

import pytest

from crosstune.client_version import ClientVersion, client_version, is_blocked, parse_version


def test_parse_version_pads_and_compares_numerically() -> None:
    assert parse_version("1.10") == (1, 10, 0)
    assert parse_version("2") == (2, 0, 0)
    assert parse_version("1.10.0") > parse_version("1.9.0")


@pytest.mark.parametrize(
    "text", [None, "", "1.2.3.4", "1.x", "v1.2", "-1.0", " 1.0", "1.0\n", "1." + "9" * 10]
)
def test_parse_version_rejects(text: str | None) -> None:
    assert parse_version(text) is None


def test_parse_version_rejects_a_part_too_long_for_int() -> None:
    # Past Python's int-from-string limit, so the length cap must reject it before int().
    assert parse_version("1." + "9" * 5000) is None


def test_client_version_needs_a_known_platform() -> None:
    assert client_version({"X-Client-Version": "1.2.0"}) is None
    assert client_version({"X-Client-Version": "1.2.0", "X-Client-Platform": "android"}) is None
    assert client_version({"X-Client-Version": "bad", "X-Client-Platform": "ios"}) is None
    assert client_version({"X-Client-Version": "1.2.0", "X-Client-Platform": "ios"}) == (
        ClientVersion("ios", "1.2.0", (1, 2, 0))
    )


def test_is_blocked_only_below_the_apple_floor() -> None:
    floor = (1, 2, 4)
    assert is_blocked(ClientVersion("macos", "1.2.3", (1, 2, 3)), floor)
    assert not is_blocked(ClientVersion("ios", "1.2.4", (1, 2, 4)), floor)
    assert not is_blocked(ClientVersion("web", "0.1.0", (0, 1, 0)), floor)
    assert not is_blocked(ClientVersion("ios", "0.1.0", (0, 1, 0)), None)
    assert not is_blocked(None, floor)
