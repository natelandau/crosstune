"""Tests for the check of the app's required Info.plist keys."""

import plistlib

import pytest

import info_plist

COMPLETE = {
    **dict.fromkeys(info_plist.PURPOSE_STRING_KEYS, "Crosstune records what you play."),
    **info_plist.REQUIRED_FLAGS,
}


@pytest.mark.parametrize(
    ("change", "failing_key"),
    [
        ({}, None),
        ({"NSMicrophoneUsageDescription": None}, "NSMicrophoneUsageDescription"),
        ({"NSCameraUsageDescription": "  "}, "NSCameraUsageDescription"),
        ({"NSSupportsLiveActivities": None}, "NSSupportsLiveActivities"),
        ({"ITSAppUsesNonExemptEncryption": True}, "ITSAppUsesNonExemptEncryption"),
    ],
)
def test_check_fails_only_on_a_missing_or_wrong_key(tmp_path, capsys, change, failing_key):
    info = {key: value for key, value in {**COMPLETE, **change}.items() if value is not None}
    path = tmp_path / "Info.plist"
    with path.open("wb") as file:
        plistlib.dump(info, file)

    status = info_plist.main(["check", str(path)])

    errors = capsys.readouterr().err
    if failing_key is None:
        assert (status, errors) == (0, "")
    else:
        assert status == 1
        assert [line.split(": ")[1].split(" ")[0] for line in errors.splitlines()] == [failing_key]


def test_check_fails_on_a_file_that_is_not_a_property_list(tmp_path):
    path = tmp_path / "Info.plist"
    path.write_text("not a plist")

    assert info_plist.main(["check", str(path)]) == 1
