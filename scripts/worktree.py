#!/usr/bin/env python3
"""Create, remove, and set up the git worktrees under the main checkout's `.worktrees/`.

Usage: worktree.py create BRANCH | remove BRANCH | copy-env

A worktree gets the main checkout's ignored local files, its own dependencies, and its own
database and bucket. Removing one deletes its branch only once main or origin/main holds the
branch's work, squash merges included.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

CHECKOUT = Path(__file__).resolve().parent.parent
# Ignored files a worktree copies from the main checkout, beside each module's `.env`.
LOCAL_FILES = ("apple/Config/Secrets.xcconfig", "apple/Config/Local.xcconfig")
SETUP_RECIPES = ("api::setup", "web::setup", "site::setup", "apple::setup")


class JustRunner(Protocol):
    """Run one `just` invocation and fail when it fails."""

    def __call__(self, *args: str, cwd: Path) -> None:
        """Run `just` with `args` in `cwd`."""


class PullRequestHeads(Protocol):
    """List the head commits of a branch's merged pull requests."""

    def __call__(self, *, branch: str, cwd: Path) -> list[str]:
        """Return the head commit of each merged pull request from `branch`."""


@dataclass(frozen=True)
class Git:
    """Run git in one folder."""

    cwd: Path

    def run(self, *args: str) -> None:
        """Run a git command whose output goes to the terminal, and fail when it fails."""
        subprocess.run(["git", *args], cwd=self.cwd, check=True)

    def output(self, *args: str) -> str:
        """Return a git command's standard output, and fail when it fails."""
        result = subprocess.run(
            ["git", *args], cwd=self.cwd, check=True, stdout=subprocess.PIPE, text=True
        )
        return result.stdout.rstrip("\n")

    def succeeds(self, *args: str) -> bool:
        """Run a git command used as a test, and report whether it passed."""
        return subprocess.run(["git", *args], cwd=self.cwd, check=False).returncode == 0


def run_just(*args: str, cwd: Path) -> None:
    """Run a just recipe and fail when it fails.

    Args:
        *args: The arguments for `just`.
        cwd: The folder `just` runs in.
    """
    subprocess.run(["just", *args], cwd=cwd, check=True)


def merged_pull_request_heads(*, branch: str, cwd: Path) -> list[str]:
    """Ask GitHub for the head commit of each merged pull request from `branch`.

    A squash merge leaves no ancestry, so a merged pull request whose head is the branch's tip
    is what proves it. Without gh, or when gh fails, there is no such proof.

    Args:
        branch: The pull requests' head branch.
        cwd: A folder inside the repository.

    Returns:
        list[str]: The head commits, empty when gh is missing or fails.
    """
    if shutil.which("gh") is None:
        return []
    result = subprocess.run(
        [
            "gh",
            "pr",
            "list",
            "--head",
            branch,
            "--state",
            "merged",
            "--json",
            "headRefOid",
            "--jq",
            ".[].headRefOid",
        ],
        cwd=cwd,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
    )
    return result.stdout.splitlines()


def main_checkout(cwd: Path) -> Path:
    """Find the main checkout from any checkout or worktree of the repository.

    Args:
        cwd: A folder inside the repository.

    Returns:
        Path: The main checkout's top folder.
    """
    common = Git(cwd).output("rev-parse", "--path-format=absolute", "--git-common-dir")
    return Path(common).parent


def is_registered(*, main: Path, path: Path) -> bool:
    """Report whether git lists `path` as one of the repository's worktrees."""
    listing = Git(main).output("worktree", "list", "--porcelain")
    return f"worktree {path}" in listing.splitlines()


def copy_env(*, cwd: Path) -> int:
    """Copy the main checkout's `.env` files, Apple secrets, and Apple local overrides here.

    Replaces any copy already in the worktree.

    Args:
        cwd: A folder inside the worktree.

    Returns:
        int: The exit status, 1 when `cwd` is in the main checkout.
    """
    main = main_checkout(cwd)
    here = Path(Git(cwd).output("rev-parse", "--show-toplevel"))
    if main == here:
        print("this is the main checkout; run this in a worktree", file=sys.stderr)
        return 1
    env_files = sorted(path for path in main.glob("*/.env") if not path.parent.name.startswith("."))
    for source in [*env_files, *(main / name for name in LOCAL_FILES)]:
        if not source.exists():
            continue
        relative = source.relative_to(main).as_posix()
        # A branch cut before a file was gitignored would otherwise commit it.
        if not Git(here).succeeds("check-ignore", "-q", relative):
            print(f"skipped {relative}: this branch does not ignore it", file=sys.stderr)
            continue
        shutil.copy(source, here / relative)
        print(f"copied {relative}")
    return 0


def create(
    *,
    branch: str,
    cwd: Path,
    justfile: Path = CHECKOUT / "justfile",
    just: JustRunner = run_just,
) -> int:
    """Create `.worktrees/<branch>` with its local files, dependencies, database, and bucket.

    The branch starts from the main checkout's HEAD, wherever this runs from.

    Args:
        branch: The new branch, which names the worktree's folder.
        cwd: A folder inside the repository.
        justfile: The justfile whose prune recipes run, so a branch cut from an older commit
            that lacks them still gets pruned.
        just: Runs each just recipe.

    Returns:
        int: The exit status.
    """
    main = main_checkout(cwd)
    path = main / ".worktrees" / branch
    Git(main).run("worktree", "add", str(path), "-b", branch)
    try:
        status = copy_env(cwd=path)
        if status == 0:
            just(*SETUP_RECIPES, cwd=path)
            just("api::worktree-db", cwd=path)
            just("--justfile", str(justfile), "api::prune-worktree-dbs", cwd=path)
            just("--justfile", str(justfile), "apple::prune-derived-data", cwd=path)
    except subprocess.CalledProcessError as error:
        status = error.returncode
    except OSError as error:
        print(f"worktree.py: {error}", file=sys.stderr)
        status = 1
    if status != 0:
        # A rerun would fail on the existing branch, so the hint says how to finish by hand.
        print(
            f"worktree created at {path} but setup failed; finish with: cd {path} && "
            "just worktree-env && just setup && just api::worktree-db",
            file=sys.stderr,
        )
        return status
    print(f"worktree ready at {path}")
    return 0


def is_merged(*, git: Git, branch: str, tip: str, pull_request_heads: PullRequestHeads) -> bool:
    """Report whether main or origin/main holds the work of `branch`, squash merges included.

    Args:
        git: Runs git in the main checkout.
        branch: The branch to check.
        tip: The branch's tip commit.
        pull_request_heads: Lists the heads of the branch's merged pull requests.

    Returns:
        bool: True when the branch's work is on main or origin/main.
    """
    if git.succeeds("merge-base", "--is-ancestor", tip, "main"):
        return True
    if git.succeeds("merge-base", "--is-ancestor", tip, "origin/main"):
        return True
    # A later local commit means work the merged pull request never saw.
    if tip in pull_request_heads(branch=branch, cwd=git.cwd):
        return True
    # Without a pull request: the branch as one commit, which git cherry marks `-` when
    # origin/main already holds the same patch.
    try:
        base = git.output("merge-base", tip, "origin/main")
        squashed = git.output("commit-tree", f"{tip}^{{tree}}", "-p", base, "-m", "squashed")
        return git.output("cherry", "origin/main", squashed).startswith("-")
    except subprocess.CalledProcessError:
        return False


def _release_mac_app(path: Path) -> None:
    """Quit the Mac app the worktree holds, with the release script its branch carries."""
    scripts = path / "apple" / "scripts"
    if (scripts / "mac_app.py").exists():
        subprocess.run([sys.executable, str(scripts / "mac_app.py"), "done"], cwd=path, check=True)
    elif (scripts / "mac-app.sh").is_file() and _is_executable(scripts / "mac-app.sh"):
        subprocess.run([str(scripts / "mac-app.sh"), "done"], cwd=path, check=True)


def _is_executable(path: Path) -> bool:
    return path.stat().st_mode & 0o111 != 0


def _remove_folder(*, main: Path, path: Path) -> bool:
    """Remove the worktree with git, and delete a folder git left behind.

    Never with --force, which discards uncommitted work. git deregisters a worktree before it
    deletes the folder, so a folder an editor filled with untracked build output stays behind.

    Returns:
        bool: False when git refused and the worktree is still registered.
    """
    if Git(main).succeeds("worktree", "remove", str(path)):
        return True
    if is_registered(main=main, path=path):
        return False
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)
    print(f"deleted {path}, which git left behind")
    return True


def remove(
    *,
    branch: str,
    cwd: Path,
    just: JustRunner = run_just,
    pull_request_heads: PullRequestHeads = merged_pull_request_heads,
) -> int:
    """Remove `.worktrees/<branch>`, its branch once merged, its database, bucket, and builds.

    Args:
        branch: The worktree's branch, which names its folder.
        cwd: A folder inside the repository.
        just: Runs each just recipe.
        pull_request_heads: Lists the heads of the branch's merged pull requests.

    Returns:
        int: The exit status.
    """
    main = main_checkout(cwd)
    path = main / ".worktrees" / branch
    if not is_registered(main=main, path=path):
        print(f"no worktree at {path}", file=sys.stderr)
        return 1
    # This worktree's files vanish below, so everything after runs from the main checkout.
    _release_mac_app(path)
    if not _remove_folder(main=main, path=path):
        return 1
    git = Git(main)
    if not git.succeeds("fetch", "--quiet", "origin", "main"):
        print("could not fetch origin; checking the merge against the last fetch", file=sys.stderr)
    tip = git.output("rev-parse", branch)
    if is_merged(git=git, branch=branch, tip=tip, pull_request_heads=pull_request_heads):
        git.run("branch", "-D", branch)
    else:
        print(f"kept branch {branch}: neither main nor origin/main holds its work", file=sys.stderr)
    for recipe in (
        "api::prune-worktree-dbs",
        "apple::prune-derived-data",
        "apple::prune-packages",
    ):
        just(
            "--justfile", str(main / "justfile"), "--working-directory", str(main), recipe, cwd=main
        )
    print(f"removed {path}")
    return 0


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
    create_parser = commands.add_parser("create", help="create .worktrees/<branch>")
    create_parser.add_argument("branch")
    remove_parser = commands.add_parser("remove", help="remove .worktrees/<branch>")
    remove_parser.add_argument("branch")
    commands.add_parser("copy-env", help="copy the main checkout's local files here")
    args = parser.parse_args(argv)
    cwd = Path.cwd()
    try:
        if args.command == "create":
            return create(branch=args.branch, cwd=cwd)
        if args.command == "remove":
            return remove(branch=args.branch, cwd=cwd)
        return copy_env(cwd=cwd)
    except subprocess.CalledProcessError as error:
        # The command that failed already said why.
        return error.returncode
    except OSError as error:
        print(f"worktree.py: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
