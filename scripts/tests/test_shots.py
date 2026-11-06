"""Tests for the decisions in the UI review capture."""

import pytest

from shots import (
    UsageError,
    base_names,
    main,
    missing,
    parse_args,
    screen_cases,
    split_captured,
    touched_platforms,
    unknown_name,
)


def test_parse_reads_platforms_and_names():
    request = parse_args(["--platform", "mac", "tune", "--platform", "ios", "catalog-filters"])
    assert request.platforms == ["mac", "ios"]
    assert request.names == ["tune", "catalog-filters"]
    assert not request.show_help


@pytest.mark.parametrize("flag", ["-h", "--help"])
def test_parse_asks_for_help(flag):
    assert parse_args(["tune", flag]).show_help


@pytest.mark.parametrize(
    "argv", [["--platform", "tvos"], ["--platform"], ["--verbose"], ["-x", "tune"]]
)
def test_parse_rejects_bad_arguments(argv):
    with pytest.raises(UsageError):
        parse_args(argv)


def test_help_prints_usage_and_succeeds(capsys):
    assert main(["--help"]) == 0
    assert "--platform web|mac|ios" in capsys.readouterr().out


def test_bad_arguments_print_usage_and_exit_2(capsys):
    assert main(["--platform", "tvos"]) == 2
    assert capsys.readouterr().err.startswith("usage: ")


def test_web_source_touches_web():
    assert touched_platforms(["web/src/app/App.tsx"]) == ["web"]
    assert touched_platforms(["web/index.html", "web/public/logo.svg"]) == ["web"]


def test_web_tests_and_tooling_touch_nothing():
    assert touched_platforms(["web/src/app/App.test.tsx", "web/src/x.test.ts"]) == []
    assert touched_platforms(["web/scripts/shots-diff.ts", "web/package.json"]) == []


def test_apple_ui_touches_mac_and_ios():
    assert touched_platforms(["apple/Crosstune/App.swift"]) == ["mac", "ios"]
    assert touched_platforms(["apple/CrosstuneKit/Sources/CrosstuneDesign/Color.swift"]) == [
        "mac",
        "ios",
    ]


def test_apple_non_ui_touches_nothing():
    assert touched_platforms(["apple/CrosstuneKit/Sources/CrosstuneAPI/Client.swift"]) == []
    assert touched_platforms(["apple/justfile"]) == []


def test_both_sides_list_web_first():
    changed = ["apple/Crosstune/App.swift", "web/src/main.tsx"]
    assert touched_platforms(changed) == ["web", "mac", "ios"]


def test_screen_cases_prefer_the_raw_value():
    source = """enum SampleScreen: String {
    case tune
    case catalogFilters = "catalog-filters"
    case Tune2 = "Bad"
        // case commented
}
"""
    assert screen_cases(source) == ["tune", "catalog-filters"]


def test_unknown_name_allows_settings_tabs():
    assert unknown_name(names=["tune", "settings-account"], cases=["tune"]) is None
    assert unknown_name(names=["tune", "nope", "also"], cases=["tune"]) == "nope"


def test_base_names_skip_cases_new_on_the_branch():
    names = ["tune", "brand-new", "settings-account"]
    assert base_names(platform="mac", names=names, known=["tune"]) == ["tune", "settings-account"]


def test_base_names_skip_settings_on_ios():
    names = ["tune", "settings-account"]
    assert base_names(platform="ios", names=names, known=["tune"]) == ["tune"]


def test_apple_platforms_without_names_are_skipped_with_a_note():
    captured, notes = split_captured(platforms=["web", "mac", "ios"], names=[])
    assert captured == ["web"]
    assert notes == [
        "mac: not captured, since no screen names were given",
        "ios: not captured, since no screen names were given",
    ]


def test_apple_platforms_with_names_are_captured():
    assert split_captured(platforms=["mac"], names=["tune"]) == (["mac"], [])


def test_missing_needs_both_appearances(tmp_path):
    (tmp_path / "tune-light--1.png").write_bytes(b"")
    (tmp_path / "tune-dark--1.png").write_bytes(b"")
    (tmp_path / "lists-light--1.png").write_bytes(b"")
    assert missing(folder=tmp_path, names=["tune", "lists", "settings-account"]) == [
        "lists",
        "settings-account",
    ]


def test_missing_from_an_absent_cache_is_every_name(tmp_path):
    assert missing(folder=tmp_path / "absent", names=["tune"]) == ["tune"]
