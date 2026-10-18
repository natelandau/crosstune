"""Each country's fixed center point, which place search leans toward, and its name."""

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Country:
    """A country's name as Apple Maps writes it in English, and a point inside it."""

    name: str
    lat: float
    lon: float


# ISO 3166-1 alpha-2 code to name and label point, from Natural Earth's 1:50m Admin 0
# countries (public domain), so the point falls inside the country rather than at its centroid.
_TABLE: dict[str, list] = json.loads(
    Path(__file__).with_name("countries.json").read_text(encoding="utf-8")
)


def country(code: str | None) -> Country | None:
    """The country for a two-letter code, or None when the code is missing or unknown."""
    entry = _TABLE.get(code.upper()) if code else None
    if entry is None:
        return None
    name, lat, lon = entry
    return Country(name=name, lat=float(lat), lon=float(lon))
