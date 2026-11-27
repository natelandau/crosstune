"""Tests that keep fixtures/manifest.json in step with the repository."""

import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
RULES: dict[str, dict[str, list[str]]] = json.loads((FIXTURES / "manifest.json").read_text())[
    "rules"
]


@pytest.mark.parametrize("folder", RULES)
def test_every_listed_file_exists(folder: str) -> None:
    listed = RULES[folder]["sources"] + RULES[folder]["readers"]
    missing = [path for path in listed if not (ROOT / path).is_file()]
    assert not missing, f"{folder}: listed files not found: {missing}"


@pytest.mark.parametrize("folder", RULES)
def test_every_reader_references_its_folder(folder: str) -> None:
    """A reader names the folder itself or uses a listed helper that does."""
    readers = {path: (ROOT / path).read_text() for path in RULES[folder]["readers"]}
    helper_names = [
        name
        for path, text in readers.items()
        if f"fixtures/{folder}" in text
        for name in [
            Path(path).stem,
            *re.findall(r"^(?:struct|enum|class) (\w+)", text, re.MULTILINE),
        ]
    ]
    unrelated = [
        path
        for path, text in readers.items()
        if f"fixtures/{folder}" not in text and not any(name in text for name in helper_names)
    ]
    assert not unrelated, f"{folder}: readers that never reach fixtures/{folder}: {unrelated}"


def test_every_folder_has_an_entry() -> None:
    folders = {entry.name for entry in FIXTURES.iterdir() if entry.is_dir()}
    assert folders == set(RULES), (
        f"fixture folders without an entry: {folders - set(RULES)}; "
        f"entries without a folder: {set(RULES) - folders}"
    )


@pytest.mark.parametrize("folder", RULES)
def test_apple_suites_name_a_listed_reader(folder: str) -> None:
    swift_text = "\n".join(
        (ROOT / path).read_text() for path in RULES[folder]["readers"] if path.endswith(".swift")
    )
    for suite in RULES[folder]["apple_suites"]:
        name = suite.split("/")[-1]
        assert re.search(rf"\bstruct {re.escape(name)}\b", swift_text), (
            f"{folder}: suite {suite} is not declared in a listed Swift reader"
        )
