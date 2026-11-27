"""Exercise the shared-case loader against fixtures/loader-checks."""

import re

import pytest

from tests.shared_cases import FIXTURES_ROOT, load_shared_case_file, load_shared_cases

INVALID_DIRECTORY = FIXTURES_ROOT / "loader-checks" / "invalid"


def test_valid_case_keeps_shared_expectation_for_api() -> None:
    """The apple override must not leak into the api platform."""
    (loaded,) = load_shared_cases("loader-checks", "api")

    assert loaded.name == "valid"
    assert loaded.expected == {"rows": ["shared"], "count": 1}


@pytest.mark.parametrize(
    ("file_name", "broken_value"),
    [
        ("unknown-key.json", "notes"),
        ("override-without-reason.json", "reason"),
        ("override-unknown-field.json", "missing"),
        ("expected-not-object.json", '"expected"'),
        ("input-missing.json", '"input"'),
        ("input-not-object.json", '"input"'),
        ("overrides-null.json", '"platform_overrides"'),
        ("description-empty.json", '"description"'),
        ("overrides-not-object.json", '"platform_overrides"'),
        ("override-not-object.json", '"apple" must be an object'),
        ("override-fields-missing.json", '"fields"'),
        ("override-fields-not-object.json", '"fields"'),
        ("override-unknown-platform.json", '"android"'),
    ],
)
def test_invalid_case_names_file_and_broken_rule(file_name: str, broken_value: str) -> None:
    """Each refusal must name the file and the rule so a fixture author can fix it."""
    with pytest.raises(ValueError, match=rf"{re.escape(file_name)}.*{re.escape(broken_value)}"):
        load_shared_case_file(INVALID_DIRECTORY / file_name, "api")


def test_empty_folder_is_refused() -> None:
    """A folder with no case must fail instead of passing with zero cases."""
    with pytest.raises(ValueError, match="no case files"):
        load_shared_cases("loader-checks/does-not-exist", "api")
