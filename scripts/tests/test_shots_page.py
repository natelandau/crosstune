"""Tests for the UI review page builder."""

import json
from pathlib import Path

from shots_page import platform_section, shot_row


def write_manifest(folder: Path, platform: str, shots: list[dict], same: int) -> None:
    (folder / platform).mkdir(parents=True)
    (folder / platform / "manifest.json").write_text(json.dumps({"shots": shots, "same": same}))


def test_added_shot_shows_only_after(tmp_path):
    row = shot_row(folder=tmp_path, platform="web", shot={"path": "a.png", "status": "added"})
    assert "(added)" in row
    assert "web/after/a.png" in row
    assert "before" not in row


def test_removed_shot_shows_only_before(tmp_path):
    row = shot_row(folder=tmp_path, platform="mac", shot={"path": "a.png", "status": "removed"})
    assert "mac/before/a.png" in row
    assert "after" not in row


def test_changed_shot_links_its_diff_when_one_exists(tmp_path):
    (tmp_path / "ios" / "diff").mkdir(parents=True)
    (tmp_path / "ios" / "diff" / "a.png").write_bytes(b"")
    row = shot_row(
        folder=tmp_path, platform="ios", shot={"path": "a.png", "status": "changed", "ratio": 0.125}
    )
    assert "12.50% of pixels changed" in row
    assert "ios/diff/a.png" in row


def test_changed_shot_without_a_diff_has_two_images(tmp_path):
    row = shot_row(folder=tmp_path, platform="web", shot={"path": "a.png", "status": "changed"})
    assert row.count("<figure>") == 2


def test_platform_without_a_manifest_says_not_captured(tmp_path):
    assert "Not captured." in platform_section(folder=tmp_path, platform="web")


def test_platform_with_no_changes_says_so(tmp_path):
    write_manifest(tmp_path, "mac", [], same=4)
    assert "No shot changed (4 unchanged)" in platform_section(folder=tmp_path, platform="mac")


def test_platform_counts_changed_and_unchanged(tmp_path):
    write_manifest(tmp_path, "ios", [{"path": "a.png", "status": "added"}], same=2)
    section = platform_section(folder=tmp_path, platform="ios")
    assert "iPhone and iPad" in section
    assert "1 changed, 2 unchanged" in section
