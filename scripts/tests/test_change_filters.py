"""Tests that every module's CI path filter and pre-push test hook name the same inputs.

Each module's inputs are written three times: the workflow's `paths` globs, its `changes`
action regex, and the pre-push hook's `files` regex. AREAS below is the one list they must all
agree with, checked path by path over every tracked file.
"""

import re
import subprocess
from collections.abc import Callable
from dataclasses import dataclass, field
from functools import cache
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Area:
    """One module's inputs, as GitHub path globs in order, where `!` excludes."""

    workflow: str
    hook: str
    paths: tuple[str, ...]
    # Globs only CI reads: the workflow and actions it runs, and config the lint hooks
    # already check at commit time. The pre-push test hook skips these.
    ci_only: tuple[str, ...] = field(default=())


AREAS = {
    "api": Area(
        workflow="api.yml",
        hook="pytest",
        paths=(
            "api/**",
            "compose.yml",
            "ruff.toml",
            "pyproject.toml",
            "uv.lock",
            "scripts/gate-cache.sh",
            "scripts/settings.just",
            "scripts/media-tools.sh",
            ".github/workflows/api.yml",
        ),
        ci_only=("ruff.toml", "pyproject.toml", "uv.lock", ".github/workflows/api.yml"),
    ),
    "web": Area(
        workflow="web.yml",
        hook="web-vitest",
        paths=(
            "web/**",
            "apple/CrosstuneKit/Sources/CrosstuneDesign/Style/**",
            "brand/**",
            "fixtures/**",
            "analytics/tracking-plan.json",
            "api/openapi.json",
            ".github/workflows/web.yml",
            ".github/actions/setup-node/**",
            "scripts/gate-cache.sh",
            "scripts/settings.just",
        ),
        ci_only=(".github/workflows/web.yml", ".github/actions/setup-node/**"),
    ),
    "site": Area(
        workflow="site.yml",
        hook="site-vitest",
        paths=(
            "site/**",
            "brand/**",
            ".github/workflows/site.yml",
            ".github/actions/setup-node/**",
            "scripts/gate-cache.sh",
            "scripts/settings.just",
            "analytics/tracking-plan.json",
        ),
        ci_only=(".github/workflows/site.yml", ".github/actions/setup-node/**"),
    ),
    "apple": Area(
        workflow="apple.yml",
        hook="apple-swift-test",
        paths=(
            "apple/**",
            "!apple/scripts/**",
            "apple/scripts/scrub-env.sh",
            "apple/scripts/xcodebuild.sh",
            "apple/scripts/source_packages.py",
            "fixtures/**",
            "api/openapi.json",
            "analytics/tracking-plan.json",
            "scripts/gate-cache.sh",
            "scripts/settings.just",
            ".github/workflows/apple.yml",
        ),
        ci_only=(".github/workflows/apple.yml",),
    ),
    "analytics": Area(
        workflow="analytics.yml",
        hook="analytics-test",
        paths=(
            "analytics/**",
            "pyproject.toml",
            "uv.lock",
            ".github/workflows/analytics.yml",
            "scripts/gate-cache.sh",
            "scripts/settings.just",
        ),
        ci_only=(".github/workflows/analytics.yml",),
    ),
    "scripts": Area(
        workflow="scripts.yml",
        hook="scripts-test",
        paths=(
            "scripts/**",
            "apple/scripts/**",
            "**/*.py",
            "!api/**",
            "ruff.toml",
            "ty.toml",
            "pyproject.toml",
            "uv.lock",
            ".github/workflows/**",
            ".pre-commit-config.yaml",
            "**/justfile",
            "**/*.just",
        ),
        # The scripts lint covers every Python file outside api/; the tests
        # cover only scripts/ and apple/scripts/.
        ci_only=("**/*.py", "!api/**", "ruff.toml", "ty.toml"),
    ),
}

# Paths no tracked file has yet, where a filter is most likely to be wrong.
PROBES = (
    "web/scripts/new.py",
    "site/scripts/new.py",
    "site/scripts/new.sh",
    "apple/scripts/new.sh",
    "apple/scripts/tests/test_new.py",
    "api/src/crosstune/new.py",
    "api/tools/new.py",
    "docs/new.md",
    "new.py",
)


def glob_regex(glob: str) -> re.Pattern[str]:
    """Translate a GitHub path glob: `**` crosses folders, `*` and `?` do not."""
    out = []
    i = 0
    while i < len(glob):
        if glob.startswith("**/", i):
            out.append("(?:.*/)?")
            i += 3
        elif glob.startswith("**", i):
            out.append(".*")
            i += 2
        elif glob[i] == "*":
            out.append("[^/]*")
            i += 1
        elif glob[i] == "?":
            out.append("[^/]")
            i += 1
        else:
            out.append(re.escape(glob[i]))
            i += 1
    return re.compile("".join(out) + r"\Z")


def glob_match(globs: tuple[str, ...] | list[str], path: str) -> bool:
    """Apply globs in order, as GitHub does: the last one that matches decides."""
    matched = False
    for glob in globs:
        negated = glob.startswith("!")
        if glob_regex(glob.removeprefix("!")).match(path):
            matched = not negated
    return matched


def regex_match(pattern: str, exclude: str, path: str) -> bool:
    """Match one path the way the `changes` action and pre-commit both do."""
    if exclude and re.search(exclude, path):
        return False
    return re.search(pattern, path) is not None


@cache
def tracked() -> tuple[str, ...]:
    files = subprocess.run(
        ["git", "ls-files"], cwd=ROOT, check=True, capture_output=True, text=True
    ).stdout.splitlines()
    return (*files, *PROBES)


@cache
def workflow(name: str) -> dict:
    doc = yaml.safe_load((ROOT / ".github/workflows" / name).read_text())
    # YAML 1.1 reads the bare key `on` as True.
    doc["on"] = doc.pop(True, doc.get("on"))
    return doc


@cache
def hooks() -> dict[str, dict]:
    config = yaml.safe_load((ROOT / ".pre-commit-config.yaml").read_text())
    return {hook["id"]: hook for repo in config["repos"] for hook in repo["hooks"]}


def changes_step(doc: dict) -> dict | None:
    for job in doc["jobs"].values():
        for step in job.get("steps", []):
            if step.get("id") == "changes":
                return step["with"]
    return None


def mismatches(expected: tuple[str, ...], actual: Callable[[str], bool]) -> list[str]:
    return [path for path in tracked() if glob_match(expected, path) != actual(path)]


@pytest.mark.parametrize("name", AREAS)
def test_workflow_paths_match_the_table(name):
    area = AREAS[name]
    on = workflow(area.workflow)["on"]
    for event in ("pull_request", "push"):
        paths = (on.get(event) or {}).get("paths")
        # A pull request filtered by the `changes` action carries no paths of its own.
        if event == "pull_request" and paths is None:
            continue
        assert paths is not None, f"{area.workflow} {event} has no paths"
        assert tuple(paths) == area.paths, f"{area.workflow} {event}.paths"


@pytest.mark.parametrize("name", AREAS)
def test_changes_pattern_matches_the_table(name):
    area = AREAS[name]
    step = changes_step(workflow(area.workflow))
    if step is None:
        pytest.skip(f"{area.workflow} filters with paths alone")
    pattern, exclude = step["pattern"], step.get("exclude", "")
    assert mismatches(area.paths, lambda p: regex_match(pattern, exclude, p)) == []


@pytest.mark.parametrize("name", AREAS)
def test_pre_push_hook_matches_the_table(name):
    area = AREAS[name]
    hook = hooks()[area.hook]
    assert hook.get("stages") == ["pre-push"]
    expected = tuple(glob for glob in area.paths if glob not in area.ci_only)
    pattern, exclude = hook["files"], hook.get("exclude", "")
    assert mismatches(expected, lambda p: regex_match(pattern, exclude, p)) == []


def test_glob_translation():
    assert glob_match(["**/justfile"], "justfile")
    assert glob_match(["**/justfile"], "web/justfile")
    assert not glob_match(["scripts/*"], "scripts/tests/x.py")
    assert not glob_match(["apple/**", "!apple/scripts/**"], "apple/scripts/x.py")
    assert glob_match(["apple/**", "!apple/scripts/**", "apple/scripts/x.sh"], "apple/scripts/x.sh")
