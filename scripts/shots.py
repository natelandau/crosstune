"""Capture the branch's UI and its merge base's, and build a review page of the shots that differ.

Captures each platform the branch touched, at the branch and at its merge base with main,
keeps only the shots that differ, and builds one review page from them in
.cache/shots/review/index.html. Base shots are cached by commit in the main checkout, so every
branch on the same base reuses them.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

PLATFORMS = ("web", "mac", "ios")
SAMPLE_SCREENS = "apple/CrosstuneKit/Sources/CrosstuneUI/Sample/SampleScreen.swift"
APPLE_CONFIG_FILES = ("apple/Config/Secrets.xcconfig", "apple/Config/Local.xcconfig")
USAGE_EXIT = 2

WEB_UI = re.compile(r"^web/(src/|index\.html|public/)")
WEB_TEST = re.compile(r"\.test\.tsx?$")
APPLE_UI = re.compile(r"^apple/(Crosstune/|CrosstuneKit/Sources/(CrosstuneUI|CrosstuneDesign)/)")
SCREEN_CASE = re.compile(r" *case ([a-zA-Z]+)( = \"([a-z-]+)\")?")


def usage(prog: str) -> str:
    """Return the usage text, naming the script the way it was run."""
    return f"""usage: {prog} [--platform web|mac|ios]... [NAME...]
NAME: SampleScreen cases for the Mac and iOS captures (tune, catalog-filters, settings-account).
The web capture takes no names: it captures its whole gallery.
Without --platform, the platforms are the ones the branch's changes since main touch."""


class UsageError(Exception):
    """The arguments do not match the usage."""


@dataclass(frozen=True)
class Request:
    """What the command line asked for."""

    platforms: list[str] = field(default_factory=list)
    names: list[str] = field(default_factory=list)
    show_help: bool = False


def parse_args(argv: list[str]) -> Request:
    """Read the platforms and screen names from the arguments.

    Args:
        argv: The arguments after the script's name.

    Returns:
        Request: The platforms and names given, or a request for help.

    Raises:
        UsageError: An unknown option, a `--platform` with no value, or an unknown platform.
    """
    platforms: list[str] = []
    names: list[str] = []
    args = list(argv)
    while args:
        arg = args.pop(0)
        if arg == "--platform":
            if not args:
                raise UsageError
            platforms.append(args.pop(0))
        elif arg in {"-h", "--help"}:
            return Request(show_help=True)
        elif arg.startswith("-"):
            raise UsageError
        else:
            names.append(arg)
    if any(platform not in PLATFORMS for platform in platforms):
        raise UsageError
    return Request(platforms=platforms, names=names)


def touched_platforms(changed: list[str]) -> list[str]:
    """Return the platforms whose UI the changed paths touch.

    Args:
        changed: Repository-relative paths changed since the base, committed or not.

    Returns:
        list[str]: `web`, then `mac` and `ios` together, for each side the paths reach.
    """
    platforms: list[str] = []
    if any(WEB_UI.match(path) and not WEB_TEST.search(path) for path in changed):
        platforms.append("web")
    if any(APPLE_UI.match(path) for path in changed):
        platforms.extend(["mac", "ios"])
    return platforms


def screen_cases(source: str) -> list[str]:
    """Return the names of the SampleScreen cases in a Swift source.

    A case with a raw value is known by that value, since it is the launch argument.

    Args:
        source: The text of SampleScreen.swift.

    Returns:
        list[str]: Each case's raw value, or its name when it has none.
    """
    cases: list[str] = []
    for line in source.splitlines():
        match = SCREEN_CASE.fullmatch(line)
        if match:
            cases.append(match.group(3) or match.group(1))
    return cases


def unknown_name(names: list[str], cases: list[str]) -> str | None:
    """Return the first name SampleScreen does not know, since it would open the plain shell.

    Args:
        names: The screen names given.
        cases: The SampleScreen cases on the branch.

    Returns:
        str | None: The first unknown name, or None when every name is known.
    """
    for name in names:
        if not name.startswith("settings-") and name not in cases:
            return name
    return None


def base_names(platform: str, names: list[str], known: list[str]) -> list[str]:
    """Return the names the base can capture on a platform.

    A case new on the branch has no base shot, so it shows as added, and iOS has no
    Settings tabs.

    Args:
        platform: `mac` or `ios`.
        names: The screen names given.
        known: The SampleScreen cases at the base.

    Returns:
        list[str]: The names, in order, that the base can capture.
    """
    capturable: list[str] = []
    for name in names:
        if name.startswith("settings-"):
            if platform != "ios":
                capturable.append(name)
        elif name in known:
            capturable.append(name)
    return capturable


def split_captured(platforms: list[str], names: list[str]) -> tuple[list[str], list[str]]:
    """Split the platforms into those to capture and notes on those skipped.

    Args:
        platforms: The platforms asked for or touched.
        names: The screen names given; the Apple captures need at least one.

    Returns:
        tuple[list[str], list[str]]: The platforms to capture, and a note per skipped one.
    """
    captured: list[str] = []
    notes: list[str] = []
    for platform in platforms:
        if platform != "web" and not names:
            notes.append(f"{platform}: not captured, since no screen names were given")
        else:
            captured.append(platform)
    return captured, notes


def missing(folder: Path, names: list[str]) -> list[str]:
    """Return the names whose light or dark shots the folder lacks.

    Args:
        folder: A platform's cache of base shots.
        names: The screen names the base can capture.

    Returns:
        list[str]: The names to capture again.
    """
    return [
        name
        for name in names
        if not (any(folder.glob(f"{name}-light--*")) and any(folder.glob(f"{name}-dark--*")))
    ]


def git(*args: str, cwd: Path | None = None) -> str:
    """Run git and return its output without the trailing newline."""
    result = subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, text=True)
    return result.stdout.rstrip("\n")


class Review:
    """One run: the branch, its base, and where their shots go."""

    def __init__(self, *, names: list[str]) -> None:
        """Find the checkout, the main checkout, and the base from git."""
        self.names = names
        self.root = Path(git("rev-parse", "--show-toplevel"))
        self.main_checkout = Path(
            git("rev-parse", "--path-format=absolute", "--git-common-dir")
        ).parent
        self.base = git("merge-base", "main", "HEAD")
        self.head = git("rev-parse", "HEAD")
        self.shots = self.root / ".cache/shots"
        self.cache = self.main_checkout / ".cache/shots/base" / self.base
        self.base_tree = self.main_checkout / ".worktrees/shots-base"
        self.base_used = False

    def changed(self) -> list[str]:
        """Return the paths changed since the base, committed or not."""
        diff = git("diff", "--name-only", self.base).splitlines()
        untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
        return sorted(set(diff + untracked))

    def base_cases(self) -> list[str]:
        """Return the SampleScreen cases at the base, or none when it has no SampleScreen."""
        try:
            return screen_cases(git("show", f"{self.base}:{SAMPLE_SCREENS}"))
        except subprocess.CalledProcessError:
            return []

    def check_out_base(self) -> None:
        """Check the base out in the detached worktree every run reuses.

        It keeps its web dependencies installed between runs. It needs no database or
        bucket, so it is not made with `just worktree`.
        """
        self.base_used = True
        if not self.base_tree.is_dir():
            # A folder deleted by hand stays registered, and git refuses to add it again.
            git("worktree", "prune", cwd=self.main_checkout)
            subprocess.run(
                ["git", "worktree", "add", "--detach", str(self.base_tree), self.base],
                cwd=self.main_checkout,
                check=True,
                stdout=subprocess.DEVNULL,
            )
        subprocess.run(
            ["git", "checkout", "--force", "--detach", self.base],
            cwd=self.base_tree,
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.run(
            ["git", "clean", "-fdq", "-e", "node_modules", "-e", ".build"],
            cwd=self.base_tree,
            check=True,
        )
        for file in APPLE_CONFIG_FILES:
            if (self.main_checkout / file).is_file():
                shutil.copyfile(self.main_checkout / file, self.base_tree / file)

    def remove_base_builds(self) -> None:
        """Delete the base's Apple builds.

        They take 11 GB or more and go stale once main moves, while the shots stay cached.
        """
        if self.base_used:
            shutil.rmtree(self.base_tree / "apple/.build", ignore_errors=True)

    def capture(self, *, platform: str, checkout: Path, out: Path, names: list[str]) -> None:
        """Capture one platform of a checkout into a folder.

        Apple captures take only the names given, so a cached base can be topped up with the
        screens it lacks.
        """
        out.mkdir(parents=True, exist_ok=True)
        if platform == "web":
            subprocess.run(
                ["pnpm", "install", "--frozen-lockfile", "--silent"],
                cwd=checkout / "web",
                check=True,
            )
            subprocess.run(
                [
                    "node",
                    str(self.root / "web/scripts/gallery-shots.mjs"),
                    "--web",
                    str(checkout / "web"),
                    "--out",
                    str(out),
                ],
                check=True,
                stdout=subprocess.DEVNULL,
            )
            return
        script = self.root / f"apple/scripts/{platform}-shots.sh"
        build: list[str] = []
        for look in ("light", "dark"):
            subprocess.run(
                [str(script), *build, "--out", str(out), "--appearance", look, *names],
                cwd=checkout,
                check=True,
                stdout=subprocess.DEVNULL,
            )
            # The iOS capture builds once; the second appearance reuses that build.
            if platform == "ios":
                build = ["--no-build"]

    def base_set(self, platform: str) -> Path:
        """Return the base shots to compare, copying only the named screens out of the cache."""
        if platform == "web":
            return self.cache / "web"
        chosen = self.shots / "base" / platform
        shutil.rmtree(chosen, ignore_errors=True)
        chosen.mkdir(parents=True)
        for name in self.names:
            for look in ("light", "dark"):
                for shot in (self.cache / platform).glob(f"{name}-{look}--*"):
                    shutil.copy(shot, chosen)
        return chosen

    def run_platform(self, platform: str) -> None:
        """Capture one platform at the base and on the branch, and diff the two."""
        print(f"capturing {platform} at the base, {self.base[:10]}")
        if platform == "web":
            if not (self.cache / "web/.complete").exists():
                self.check_out_base()
                shutil.rmtree(self.cache / "web", ignore_errors=True)
                self.capture(
                    platform="web", checkout=self.base_tree, out=self.cache / "web", names=[]
                )
                (self.cache / "web/.complete").touch()
        else:
            capturable = base_names(platform=platform, names=self.names, known=self.base_cases())
            lacking = missing(folder=self.cache / platform, names=capturable)
            if lacking:
                self.check_out_base()
                self.capture(
                    platform=platform,
                    checkout=self.base_tree,
                    out=self.cache / platform,
                    names=lacking,
                )

        print(f"capturing {platform} on the branch")
        branch = self.shots / "branch" / platform
        self.capture(platform=platform, checkout=self.root, out=branch, names=self.names)

        diff = subprocess.run(
            [
                "node",
                str(self.root / "web/scripts/shots-diff.mjs"),
                str(self.base_set(platform)),
                str(branch),
                str(self.shots / "review" / platform),
            ],
            check=True,
            stdout=subprocess.PIPE,
            text=True,
        )
        lines = diff.stdout.splitlines()
        if lines:
            print(f"{platform}: {lines[-1]}")

    def build_page(self, *, platforms: list[str], notes: list[str]) -> None:
        """Write the review page from every platform's diff."""
        command = [
            sys.executable,
            str(self.root / "scripts/shots_page.py"),
            str(self.shots / "review"),
        ]
        if git("status", "--porcelain"):
            command.append("--dirty")
        command += [
            "--branch",
            git("branch", "--show-current"),
            "--base",
            self.base,
            "--head",
            self.head,
            "--platforms",
            " ".join(platforms),
        ]
        if notes:
            command += ["--note", *notes]
        subprocess.run(command, check=True)


def main(argv: list[str]) -> int:
    """Run the review capture and return its exit status."""
    prog = sys.argv[0] if sys.argv else "shots.py"
    try:
        request = parse_args(argv)
    except UsageError:
        print(usage(prog), file=sys.stderr)
        return USAGE_EXIT
    if request.show_help:
        print(usage(prog))
        return 0

    try:
        review = Review(names=request.names)
        platforms = request.platforms or touched_platforms(review.changed())
        if not platforms:
            print("no UI change since main: nothing to capture")
            return 0

        cases = screen_cases((review.root / SAMPLE_SCREENS).read_text())
        name = unknown_name(names=request.names, cases=cases)
        if name is not None:
            print(f"no SampleScreen case is named {name}", file=sys.stderr)
            return USAGE_EXIT

        captured, notes = split_captured(platforms=platforms, names=request.names)
        shutil.rmtree(review.shots / "branch", ignore_errors=True)
        shutil.rmtree(review.shots / "review", ignore_errors=True)
        (review.shots / "review").mkdir(parents=True)
        try:
            for platform in captured:
                review.run_platform(platform)
        finally:
            review.remove_base_builds()

        review.build_page(platforms=platforms, notes=notes)
        for note in notes:
            print(note)
        print(f"review page: {review.shots / 'review/index.html'}")
    except subprocess.CalledProcessError as error:
        if error.stderr:
            sys.stderr.write(error.stderr)
        return error.returncode
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
