"""Tests for creating and removing worktrees, on real temporary repositories."""

import subprocess
from pathlib import Path

import pytest

import worktree

TIP_OF_ANOTHER_BRANCH = "0" * 40


def git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", *args], cwd=cwd, check=True, capture_output=True, text=True
    ).stdout.strip()


def commit_file(cwd: Path, name: str, text: str, *, mode: int = 0o644) -> None:
    path = cwd / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(mode)
    git(cwd, "add", name)
    git(cwd, "commit", "-q", "-m", f"add {name}")


def has_branch(main: Path, branch: str) -> bool:
    return bool(git(main, "branch", "--list", branch))


class FakeJust:
    """Record each just call, and fail every one when asked to."""

    def __init__(self, *, fail: bool = False) -> None:
        self.calls: list[tuple[tuple[str, ...], Path]] = []
        self.fail = fail

    def __call__(self, *args: str, cwd: Path) -> None:
        self.calls.append((args, cwd))
        if self.fail:
            raise subprocess.CalledProcessError(returncode=3, cmd=["just", *args])


def no_pull_requests(*, branch: str, cwd: Path) -> list[str]:
    return []


@pytest.fixture(autouse=True)
def isolated_git(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    config = tmp_path / "gitconfig"
    config.write_text(
        "[user]\n\tname = Test\n\temail = test@example.com\n"
        "[init]\n\tdefaultBranch = main\n[commit]\n\tgpgSign = false\n"
    )
    monkeypatch.setenv("GIT_CONFIG_GLOBAL", str(config))
    monkeypatch.setenv("GIT_CONFIG_NOSYSTEM", "1")
    # A git hook that runs these tests sets these, and they would point every command here
    # at the outer repository.
    for name in ("GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"):
        monkeypatch.delenv(name, raising=False)


@pytest.fixture
def main(tmp_path: Path) -> Path:
    root = tmp_path.resolve()
    origin = root / "origin.git"
    git(root, "init", "-q", "--bare", str(origin))
    checkout = root / "main"
    git(root, "clone", "-q", str(origin), str(checkout))
    (checkout / ".gitignore").write_text(".worktrees/\n*/.env\n")
    git(checkout, "add", ".gitignore")
    git(checkout, "commit", "-q", "-m", "start")
    commit_file(checkout, "api/README", "api\n")
    git(checkout, "push", "-q", "origin", "main")
    return checkout


def add_worktree(main: Path, branch: str) -> Path:
    path = main / ".worktrees" / branch
    git(main, "worktree", "add", "-q", str(path), "-b", branch)
    commit_file(path, "feature.txt", f"{branch}\n")
    return path


def remove(
    cwd: Path, branch: str, *, heads: worktree.PullRequestHeads = no_pull_requests
) -> tuple[int, FakeJust]:
    just = FakeJust()
    status = worktree.remove(branch=branch, cwd=cwd, just=just, pull_request_heads=heads)
    return status, just


def test_remove_deletes_a_branch_main_holds(main):
    path = add_worktree(main, "feat")
    git(main, "merge", "-q", "--ff-only", "feat")

    status, just = remove(main, "feat")

    assert status == 0
    assert not path.exists()
    assert not has_branch(main, "feat")
    prefix = ("--justfile", str(main / "justfile"), "--working-directory", str(main))
    assert just.calls == [
        ((*prefix, "api::prune-worktree-dbs"), main),
        ((*prefix, "apple::prune-derived-data"), main),
        ((*prefix, "apple::prune-packages"), main),
    ]


def test_remove_deletes_a_branch_squash_merged_on_origin(main):
    add_worktree(main, "feat")
    git(main, "merge", "-q", "--squash", "feat")
    git(main, "commit", "-q", "-m", "squashed feat")
    git(main, "push", "-q", "origin", "main")
    # Only origin holds the squash, as when the pull request merged on GitHub.
    git(main, "reset", "-q", "--hard", "HEAD~1")

    status, _ = remove(main, "feat")

    assert status == 0
    assert not has_branch(main, "feat")


def test_remove_keeps_an_unmerged_branch(main, capfd):
    path = add_worktree(main, "feat")

    status, just = remove(main, "feat")

    assert status == 0
    assert not path.exists()
    assert has_branch(main, "feat")
    assert "kept branch feat: neither main nor origin/main holds its work" in capfd.readouterr().err
    assert len(just.calls) == 3


def test_remove_trusts_a_merged_pull_request_whose_head_is_the_tip(main):
    path = add_worktree(main, "feat")
    tip = git(path, "rev-parse", "HEAD")
    asked: list[str] = []

    def heads(*, branch: str, cwd: Path) -> list[str]:
        asked.append(branch)
        return [TIP_OF_ANOTHER_BRANCH, tip]

    status, _ = remove(main, "feat", heads=heads)

    assert status == 0
    assert asked == ["feat"]
    assert not has_branch(main, "feat")


def test_remove_keeps_a_branch_with_work_after_the_merged_pull_request(main):
    add_worktree(main, "feat")

    def heads(*, branch: str, cwd: Path) -> list[str]:
        return [TIP_OF_ANOTHER_BRANCH]

    status, _ = remove(main, "feat", heads=heads)

    assert status == 0
    assert has_branch(main, "feat")


def test_remove_refuses_an_unknown_worktree(main, capfd):
    status, just = remove(main, "missing")

    assert status == 1
    assert f"no worktree at {main / '.worktrees' / 'missing'}" in capfd.readouterr().err
    assert just.calls == []


def test_remove_keeps_a_worktree_with_uncommitted_changes(main):
    path = add_worktree(main, "feat")
    (path / "feature.txt").write_text("changed\n")

    status, just = remove(main, "feat")

    assert status == 1
    assert (path / "feature.txt").read_text() == "changed\n"
    assert has_branch(main, "feat")
    assert just.calls == []


def test_remove_runs_from_inside_the_worktree(main):
    path = add_worktree(main, "feat")
    git(main, "merge", "-q", "--ff-only", "feat")

    status, _ = remove(path, "feat")

    assert status == 0
    assert not has_branch(main, "feat")


@pytest.mark.parametrize(
    ("name", "text", "mode"),
    [
        (
            "apple/scripts/mac_app.py",
            (
                "import os, pathlib, sys\n"
                "pathlib.Path(os.environ['MARKER']).write_text(f'{pathlib.Path.cwd()} {sys.argv[1]}')\n"
            ),
            0o644,
        ),
        (
            "apple/scripts/mac-app.sh",
            '#!/bin/sh\nprintf "%s %s" "$PWD" "$1" > "$MARKER"\n',
            0o755,
        ),
    ],
)
def test_remove_releases_the_mac_app_first(main, tmp_path, monkeypatch, name, text, mode):
    marker = tmp_path / "released"
    monkeypatch.setenv("MARKER", str(marker))
    commit_file(main, name, text, mode=mode)
    path = add_worktree(main, "feat")

    status, _ = remove(main, "feat")

    assert status == 0
    assert marker.read_text() == f"{path} done"


def test_create_adds_the_worktree_and_sets_it_up(main, capfd):
    (main / "api" / ".env").write_text("SECRET=1\n")
    (main / "apple" / "Config").mkdir(parents=True)
    (main / "apple" / "Config" / "Secrets.xcconfig").write_text("KEY = 1\n")
    just = FakeJust()
    justfile = Path("/checkout/justfile")

    status = worktree.create(branch="feat", cwd=main, justfile=justfile, just=just)

    path = main / ".worktrees" / "feat"
    assert status == 0
    assert git(path, "branch", "--show-current") == "feat"
    assert (path / "api" / ".env").read_text() == "SECRET=1\n"
    assert not (path / "apple" / "Config" / "Secrets.xcconfig").exists()
    output = capfd.readouterr()
    assert "skipped apple/Config/Secrets.xcconfig: this branch does not ignore it" in output.err
    assert "copied api/.env" in output.out
    assert output.out.rstrip().endswith(f"worktree ready at {path}")
    assert just.calls == [
        (worktree.SETUP_RECIPES, path),
        (("api::worktree-db",), path),
        (("--justfile", str(justfile), "api::prune-worktree-dbs"), path),
        (("--justfile", str(justfile), "apple::prune-derived-data"), path),
    ]


def test_create_says_how_to_finish_when_setup_fails(main, capfd):
    status = worktree.create(branch="feat", cwd=main, just=FakeJust(fail=True))

    path = main / ".worktrees" / "feat"
    assert status == 3
    assert path.is_dir()
    assert (
        f"worktree created at {path} but setup failed; finish with: cd {path} && "
        "just worktree-env && just setup && just api::worktree-db"
    ) in capfd.readouterr().err


def test_create_fails_on_an_existing_branch_without_the_hint(main, monkeypatch, capfd):
    git(main, "branch", "feat")
    monkeypatch.chdir(main)

    status = worktree.main(["create", "feat"])

    assert status != 0
    assert "setup failed" not in capfd.readouterr().err


def test_copy_env_replaces_the_worktree_copy(main):
    (main / "api" / ".env").write_text("NEW=1\n")
    path = add_worktree(main, "feat")
    (path / "api" / ".env").write_text("OLD=1\n")

    assert worktree.copy_env(cwd=path) == 0
    assert (path / "api" / ".env").read_text() == "NEW=1\n"


def test_copy_env_refuses_the_main_checkout(main, monkeypatch, capfd):
    monkeypatch.chdir(main)

    assert worktree.main(["copy-env"]) == 1
    assert "this is the main checkout; run this in a worktree" in capfd.readouterr().err
