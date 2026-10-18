"""Display names for places, in one format everywhere a place is shown.

A place named from coordinates is its town. A place picked in search keeps what was picked:
a named place with its street and town, a street address with its town, or a town. The town
is the one on the mailing address.
"""

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass

from crosstune.vocabulary import LIMITS

PLACE_NAME_MAX = LIMITS["recordings"]["place_name"]
_DANGLING = re.compile(r"[,\s]+$")
_ZWJ = "\u200d"
_MARKS = frozenset({"Mn", "Mc", "Me"})
# Code points that only ever modify the one before them.
_CONTINUATIONS = (
    range(0xFE00, 0xFE10),  # variation selectors
    range(0x1F3FB, 0x1F400),  # skin tone modifiers
    range(0xE0020, 0xE0080),  # tag characters, as in subdivision flags
)
_REGIONAL_INDICATORS = "".join(map(chr, range(0x1F1E6, 0x1F200)))
# How Apple's display lines name the United States, whose places are named `locality, ST`.
_US = "United States"
_ZIP = re.compile(r"^([A-Z]{2})\s+\d{5}(?:-\d{4})?$")


@dataclass(frozen=True)
class PickedName:
    """What a search result stores as a place's name, and the two lines that show it in a list."""

    name: str
    title: str
    subtitle: str | None


def place_name(result: Mapping[str, object]) -> str | None:
    """Format an Apple Maps place as `locality, ST` in the US, `locality, Country` elsewhere.

    Args:
        result: An Apple Maps place object.

    Returns:
        str | None: The name, the place's own `name` when it has no locality, or None when
            nothing usable is present. Cut to the length a recording stores.
    """
    name = _formatted(result)
    return _stored(name) if name else None


def suggestion_name(result: Mapping[str, object], home: str | None) -> PickedName | None:
    """Name a type-ahead suggestion the way the user picked it, from its display lines.

    Apple's first line is a named place, a street address, or a town, and the second the rest
    of the address down to the country, which already names the mailing-address town. The stored
    name is both lines without a US ZIP code, and without the country for a US place, whose
    town is `locality, ST`. The list rows also leave out the account's own country. A one-line
    suggestion is its own title.

    Args:
        result: An Apple Maps autocomplete result.
        home: The account country's name as Apple writes it, or None.

    Returns:
        PickedName | None: The stored name and the result's two display lines, each cut to the
            length a recording stores, or None when nothing usable is present.
    """
    raw = result.get("displayLines")
    lines = [line for line in map(_text, raw if isinstance(raw, list) else []) if line]
    if not lines:
        return None
    if len(lines) == 1:
        parts = _parts(lines[0])
        country = parts.pop() if len(parts) > 1 and _is_country(parts[-1], result) else None
        title = _joined(*parts, _kept(country, home))
        name = _joined(*parts, _kept(country, _US))
        return _picked(name, title, None)
    title = lines[0]
    parts = _parts(", ".join(lines[1:]))
    country = parts.pop() if parts and _is_country(parts[-1], result) else None
    town = None if country else _structured_town(_address(result))
    parts = [part for part in (*parts, town) if part and part.casefold() != title.casefold()]
    return _picked(
        _joined(title, *parts, _kept(country, _US)), title, _joined(*parts, _kept(country, home))
    )


def _parts(line: str) -> list[str]:
    """A display line's comma-separated parts, a US `ST 12345` cut to its state code."""
    parts = [part.strip() for part in line.split(",")]
    return [_ZIP.sub(r"\1", part) for part in parts if part]


def _is_country(part: str, result: Mapping[str, object]) -> bool:
    """Whether a display line's last part is its country rather than a street that ends it.

    A country name never holds a digit; a street without one is told apart by the structured
    address when there is one.
    """
    if any(char.isdigit() for char in part):
        return False
    address = _address(result)
    streets = (_text(address.get("fullThoroughfare")), _text(address.get("thoroughfare")))
    return part.casefold() not in {street.casefold() for street in streets if street}


def _kept(country: str | None, dropped: str | None) -> str | None:
    """`country`, unless it is the one a name leaves out."""
    if country and dropped and country.casefold() == dropped.casefold():
        return None
    return country


def _structured_town(address: Mapping[str, object]) -> str | None:
    return _joined(_text(address.get("locality")), _text(address.get("administrativeAreaCode")))


def _picked(name: str | None, title: str | None, subtitle: str | None) -> PickedName | None:
    stored = _stored(name) if name else None
    if not stored:
        return None
    return PickedName(
        name=stored,
        title=(_stored(title) if title else None) or stored,
        subtitle=_stored(subtitle) if subtitle else None,
    )


def _joined(*parts: str | None) -> str | None:
    return ", ".join(part for part in parts if part) or None


def _address(result: Mapping[str, object]) -> Mapping[str, object]:
    structured = result.get("structuredAddress")
    return structured if isinstance(structured, Mapping) else {}


def _formatted(result: Mapping[str, object]) -> str | None:
    return _town(result) or _text(result.get("name"))


def _town(result: Mapping[str, object]) -> str | None:
    """`locality, ST` in the US, `locality, Country` elsewhere, or None with no locality."""
    address = _address(result)
    locality = _mailing_town(address, result.get("formattedAddressLines"))
    if not locality:
        return None
    if result.get("countryCode") == "US":
        region = _text(address.get("administrativeAreaCode"))
        return f"{locality}, {region}" if region else locality
    country = _text(result.get("country"))
    return f"{locality}, {country}" if country else locality


def _mailing_town(address: Mapping[str, object], lines: object) -> str | None:
    """The town the mailing address names: the `subLocality` when a formatted line starts with it.

    Apple Maps sets `locality` to New York for every borough and puts the borough, the town on
    the mailing address, in `subLocality`. Elsewhere `subLocality` is a neighborhood the
    address leaves out.
    """
    locality = _text(address.get("locality"))
    town = _text(address.get("subLocality"))
    if not town or not isinstance(lines, list):
        return locality
    named = any(
        isinstance(line, str) and line.strip().casefold().startswith(f"{town},".casefold())
        for line in lines
    )
    return town if named else locality


def _stored(name: str) -> str | None:
    """`name` cut to the stored length, without the separator a cut can leave dangling."""
    return _DANGLING.sub("", whole_characters(name, PLACE_NAME_MAX)) or None


def _extends(char: str) -> bool:
    """Whether `char` belongs to the character before it rather than starting its own."""
    code = ord(char)
    return (
        unicodedata.category(char) in _MARKS
        or char == _ZWJ
        or any(code in block for block in _CONTINUATIONS)
    )


def whole_characters(name: str, limit: int) -> str:
    """Cut text to a column's code-point limit without splitting a character made of several.

    Close to Apple's grapheme rule for the text a name holds, with no segmentation
    library: a cut never strands a mark, joiner, selector, modifier, or tag from its base,
    nor half of a flag.

    Args:
        name: The text to cut.
        limit: The most code points to keep.

    Returns:
        str: `name` unchanged when it fits, else its longest whole-character prefix.
    """
    if len(name) <= limit:
        return name
    end = limit
    while end > 0 and (_extends(name[end]) or name[end - 1] == _ZWJ):
        end -= 1
    cut = name[:end]
    # Regional indicators pair into flags, so an odd run at the end is half a flag.
    indicators = len(cut) - len(cut.rstrip(_REGIONAL_INDICATORS))
    return cut[:-1] if indicators % 2 else cut


def _text(value: object) -> str | None:
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None
