"""Load the platform-independent cases under fixtures/ for the API readers."""

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

FIXTURES_ROOT = Path(__file__).resolve().parents[2] / "fixtures"

_TOP_LEVEL_KEYS = ("description", "input", "expected", "platform_overrides")
_PLATFORMS = ("web", "apple", "api")


@dataclass(frozen=True)
class SharedCase:
    """One shared case with the platform's overrides already merged into `expected`."""

    name: str
    input: dict[str, object]
    expected: dict[str, object]


def _object_at(*, value: object, file_name: str, label: str) -> dict[str, object]:
    """Return `value` when it is a JSON object, otherwise raise naming the file and key."""
    if not isinstance(value, dict):
        msg = f"{file_name}: {label} must be an object, got {value!r}"
        raise ValueError(msg)  # noqa: TRY004  # every refusal raises one error type
    return value


def load_shared_case_file(path: Path, platform: Literal["api"]) -> SharedCase:
    """Read one case file so a fixture refusal can be tested against a single file.

    Args:
        path: The case file to read.
        platform: The platform whose overrides apply.

    Returns:
        The case with overrides merged over `expected`, shallow by top-level key.

    Raises:
        ValueError: When a value has the wrong JSON type, a key is not allowed, a required
            value is missing or empty, or an override names a field absent from `expected`.
    """
    file_name = path.name
    raw = _object_at(value=json.loads(path.read_text()), file_name=file_name, label="the top level")
    unknown_keys = sorted(set(raw) - set(_TOP_LEVEL_KEYS))
    if unknown_keys:
        msg = f"{file_name}: top-level key {unknown_keys} is not one of {list(_TOP_LEVEL_KEYS)}"
        raise ValueError(msg)

    description = raw.get("description")
    if not isinstance(description, str) or not description.strip():
        msg = f'{file_name}: "description" must be a non-empty string, got {description!r}'
        raise ValueError(msg)
    if "input" not in raw:
        msg = f'{file_name}: "input" is missing'
        raise ValueError(msg)
    case_input = _object_at(value=raw["input"], file_name=file_name, label='"input"')
    expected = dict(_object_at(value=raw.get("expected"), file_name=file_name, label='"expected"'))

    overrides = _object_at(
        value=raw.get("platform_overrides", {}), file_name=file_name, label='"platform_overrides"'
    )
    merged_fields: dict[str, object] = {}
    for override_platform, raw_override in sorted(overrides.items()):
        label = f'override "{override_platform}"'
        if override_platform not in _PLATFORMS:
            msg = f"{file_name}: {label} is not one of {list(_PLATFORMS)}"
            raise ValueError(msg)
        override = _object_at(value=raw_override, file_name=file_name, label=label)
        reason = override.get("reason")
        if not isinstance(reason, str) or not reason.strip():
            msg = f'{file_name}: {label} needs a non-empty "reason", got {reason!r}'
            raise ValueError(msg)
        fields = _object_at(
            value=override.get("fields"), file_name=file_name, label=f'{label} "fields"'
        )
        for field in fields:
            if field not in expected:
                msg = f'{file_name}: {label} field "{field}" is absent from expected, which has {sorted(expected)}'
                raise ValueError(msg)
        if override_platform == platform:
            merged_fields = fields
    expected.update(merged_fields)

    return SharedCase(name=path.stem, input=case_input, expected=expected)


def load_shared_cases(folder: str, platform: Literal["api"]) -> list[SharedCase]:
    """Load every case in `fixtures/<folder>` for a reader that asserts the shared rules.

    Args:
        folder: The folder under `fixtures/`.
        platform: The platform whose overrides apply.

    Returns:
        The cases sorted by file name.

    Raises:
        ValueError: When the folder holds no `.json` case, or a case is malformed.
    """
    paths = sorted((FIXTURES_ROOT / folder).glob("*.json"))
    if not paths:
        msg = f"fixtures/{folder} has no case files; expected at least one .json file"
        raise ValueError(msg)
    return [load_shared_case_file(path, platform) for path in paths]
