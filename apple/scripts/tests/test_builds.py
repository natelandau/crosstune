"""Tests for deleting the Apple builds of idle checkouts."""

from pathlib import Path

import builds
from builds import OpenFile


def checkout(root: Path, name: str) -> Path:
    path = root / name
    for folder in builds.BUILD_FOLDERS:
        (path / folder).mkdir(parents=True)
        (path / folder / "product").write_bytes(b"x" * 4096)
    (path / "apple" / "Sources").mkdir()
    (path / "apple" / ".build" / "archives").mkdir()
    return path


def test_parse_lsof_tags_each_file_with_its_process():
    output = (
        "p12\ncxcodebuild\nfcwd\nn/repo/apple\nn/repo/apple/.build/x\np34\ncsourcekit-lsp\nn/\n"
    )

    assert builds.parse_lsof(output) == [
        OpenFile(pid=12, command="xcodebuild", path="/repo/apple"),
        OpenFile(pid=12, command="xcodebuild", path="/repo/apple/.build/x"),
        OpenFile(pid=34, command="sourcekit-lsp", path="/"),
    ]


def test_a_tool_in_a_worktree_never_marks_the_main_checkout_busy():
    main = Path("/repo")
    worktree = main / ".worktrees" / "feature"
    files = [OpenFile(pid=1, command="xcodebuild", path=f"{worktree}/apple/.build/x")]

    assert builds.busy(checkout=main, files=files) is None
    assert builds.busy(checkout=worktree, files=files) == files[0]


def test_a_tool_at_the_top_of_a_checkout_does_not_mark_it_busy():
    files = [OpenFile(pid=1, command="sourcekit-lsp", path="/repo")]

    assert builds.busy(checkout=Path("/repo"), files=files) is None


def test_a_sibling_folder_with_a_longer_name_is_not_the_checkout():
    files = [OpenFile(pid=1, command="swift-build", path="/repo/apple-old/x")]

    assert builds.busy(checkout=Path("/repo"), files=files) is None


def test_prune_cleans_idle_checkouts_and_keeps_busy_ones(tmp_path, capsys):
    idle = checkout(tmp_path, "idle")
    working = checkout(tmp_path, "working")
    files = [OpenFile(pid=7, command="swift-frontend", path=f"{working}/apple/Sources")]

    freed = builds.prune(checkouts=[idle, working], files=files, cache=tmp_path / "cache")

    assert freed >= 3 * 4096
    assert all(not (idle / folder).exists() for folder in builds.BUILD_FOLDERS)
    assert (idle / "apple" / "Sources").is_dir()
    assert (idle / "apple" / ".build" / "archives").is_dir()
    assert all((working / folder).is_dir() for folder in builds.BUILD_FOLDERS)
    out = capsys.readouterr().out
    assert f"kept {working}: swift-frontend (pid 7) is using it" in out
    assert f"of builds from {idle}" in out


def test_a_live_script_marker_keeps_the_checkout(tmp_path, capsys):
    working = checkout(tmp_path, "working")
    (working / builds.IN_USE).mkdir(parents=True)
    (working / builds.IN_USE / "41").touch()

    builds.prune(
        checkouts=[working], files=[], cache=tmp_path / "cache", alive=lambda pid: pid == 41
    )

    assert all((working / folder).is_dir() for folder in builds.BUILD_FOLDERS)
    assert f"kept {working}: a script (pid 41) is using its builds" in capsys.readouterr().out


def test_a_marker_whose_process_is_gone_is_ignored(tmp_path):
    idle = checkout(tmp_path, "idle")
    (idle / builds.IN_USE).mkdir(parents=True)
    (idle / builds.IN_USE / "41").touch()

    builds.prune(checkouts=[idle], files=[], cache=tmp_path / "cache", alive=lambda _pid: False)

    assert all(not (idle / folder).exists() for folder in builds.BUILD_FOLDERS)


def test_in_use_marks_the_builds_only_inside_the_block(tmp_path):
    apple = tmp_path / "main" / "apple"
    apple.mkdir(parents=True)

    with builds.in_use(apple):
        assert builds.marked(checkout=apple.parent) is not None

    assert builds.marked(checkout=apple.parent) is None
