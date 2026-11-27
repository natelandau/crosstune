"""Check the mono decision against fixtures/mono, which the Apple client also reads."""

import pytest

from crosstune.jobs.mono import is_mono_energy
from tests.shared_cases import SharedCase, load_shared_cases

CASES = load_shared_cases("mono", "api")


def test_finds_the_shared_cases() -> None:
    assert len(CASES) >= 10


@pytest.mark.parametrize("case", CASES, ids=[case.name for case in CASES])
def test_decides_like_the_shared_case(case: SharedCase) -> None:
    result = is_mono_energy(
        left=float(case.input["left"]),
        right=float(case.input["right"]),
        cross=float(case.input["cross"]),
        frames=int(case.input["frames"]),
    )

    assert result is case.expected["is_mono"]
