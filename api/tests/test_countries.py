"""The country table place search leans toward."""

import pytest

from crosstune.places.countries import Country, country


def test_a_known_country_has_its_name_and_a_point_inside_it() -> None:
    us = country("US")
    assert us is not None
    assert us.name == "United States"
    assert 24 < us.lat < 50
    assert -125 < us.lon < -66
    assert country("ie") == country("IE")


@pytest.mark.parametrize("code", [None, "", "XX", "ZZ"])
def test_a_missing_or_unknown_country_has_none(code: str | None) -> None:
    assert country(code) is None


def test_every_entry_is_a_name_and_a_point() -> None:
    for code in ("AR", "EG", "GB", "FR", "NO", "AU"):
        entry = country(code)
        assert isinstance(entry, Country)
        assert entry.name
        assert -90 <= entry.lat <= 90
        assert -180 <= entry.lon <= 180
