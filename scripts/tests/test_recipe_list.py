"""Tests that keep `just --list` readable in an 80-column terminal."""

import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
WIDTH = 80
# `just --list` indents each line by four spaces and puts " # " before the description.
INDENT = 4
SEPARATOR = 3


def dump() -> dict:
    result = subprocess.run(
        ["just", "--dump", "--dump-format", "json"],
        cwd=ROOT,
        check=True,
        stdout=subprocess.PIPE,
        text=True,
    )
    return json.loads(result.stdout)


def signature(recipe: dict) -> str:
    parts = [recipe["name"]]
    for parameter in recipe["parameters"]:
        prefix = {"star": "*", "plus": "+"}.get(parameter["kind"], "")
        name = ("$" if parameter["export"] else "") + parameter["name"]
        default = parameter["default"]
        suffix = "" if default is None else "=" + json.dumps(default)
        parts.append(prefix + name + suffix)
    return " ".join(parts)


def listings(justfile: dict, module: str = "") -> list[tuple[str, dict]]:
    found = [(module, justfile)]
    for name, submodule in justfile.get("modules", {}).items():
        found += listings(submodule, f"{module}{name}::")
    return found


LISTINGS = listings(dump())


def public(justfile: dict) -> list[dict]:
    return [recipe for recipe in justfile["recipes"].values() if not recipe["private"]]


@pytest.mark.parametrize(("module", "justfile"), LISTINGS, ids=[m or "root" for m, _ in LISTINGS])
def test_every_listed_line_fits_80_columns(module, justfile):
    rows = [(signature(recipe), recipe["doc"] or "") for recipe in public(justfile)]
    rows += [(f"{name} ...", sub["doc"] or "") for name, sub in justfile["modules"].items()]
    column = INDENT + max(len(left) for left, _ in rows) + SEPARATOR
    too_long = [f"{module}{left}: {doc}" for left, doc in rows if column + len(doc) > WIDTH]
    assert not too_long, f"shorten these to {WIDTH - column} characters or fewer"


@pytest.mark.parametrize(("module", "justfile"), LISTINGS, ids=[m or "root" for m, _ in LISTINGS])
def test_every_public_recipe_has_a_description(module, justfile):
    missing = [f"{module}{recipe['name']}" for recipe in public(justfile) if not recipe["doc"]]
    assert not missing


@pytest.mark.parametrize(("module", "justfile"), LISTINGS, ids=[m or "root" for m, _ in LISTINGS])
def test_every_public_parameter_has_help(module, justfile):
    missing = []
    for recipe in public(justfile):
        helped = {
            attribute["arg"]["name"]
            for attribute in recipe["attributes"]
            if isinstance(attribute, dict) and "arg" in attribute and attribute["arg"]["help"]
        }
        missing += [
            f"{module}{recipe['name']} {parameter['name']}"
            for parameter in recipe["parameters"]
            if parameter["name"] not in helped
        ]
    assert not missing, "add [arg(NAME, help=...)] so `just --usage` explains them"
