"""Tests for pruning the DerivedData of removed checkouts."""

import plistlib
from pathlib import Path

import pytest

import derived_data


def derived(root: Path, name: str, workspace: str | None) -> Path:
    folder = root / name
    folder.mkdir(parents=True)
    if workspace is not None:
        with (folder / "info.plist").open("wb") as file:
            plistlib.dump({"WorkspacePath": workspace}, file)
    return folder


def test_prune_deletes_only_crosstune_folders_whose_project_is_gone(tmp_path, capsys):
    root = tmp_path / "DerivedData"
    project = tmp_path / "Crosstune.xcodeproj"
    project.mkdir()
    kept = derived(root, "Crosstune-kept", str(project))
    gone = derived(root, "Crosstune-gone", str(tmp_path / "removed" / "Crosstune.xcodeproj"))
    unrecorded = derived(root, "Crosstune-unrecorded", None)
    other = derived(root, "Other-gone", str(tmp_path / "removed" / "Other.xcodeproj"))

    derived_data.prune(root)

    assert kept.exists()
    assert not gone.exists()
    assert unrecorded.exists()
    assert other.exists()
    assert capsys.readouterr().out == (
        f"removed Crosstune-gone ({tmp_path / 'removed' / 'Crosstune.xcodeproj'})\n"
    )


def test_prune_keeps_a_folder_whose_record_does_not_parse(tmp_path):
    folder = tmp_path / "Crosstune-broken"
    folder.mkdir()
    (folder / "info.plist").write_text("not a plist")

    derived_data.prune(tmp_path)

    assert folder.exists()


def test_prune_keeps_a_folder_with_no_recorded_path(tmp_path):
    folder = derived(tmp_path, "Crosstune-empty", "")

    derived_data.prune(tmp_path)

    assert folder.exists()


def test_prune_ignores_a_missing_derived_data_folder(tmp_path):
    derived_data.prune(tmp_path / "missing")


def test_main_prunes_xcodes_folder(tmp_path, monkeypatch: pytest.MonkeyPatch):
    gone = derived(tmp_path, "Crosstune-gone", str(tmp_path / "removed"))
    monkeypatch.setattr(derived_data, "DERIVED_DATA", tmp_path)

    assert derived_data.main(["prune"]) == 0
    assert not gone.exists()
