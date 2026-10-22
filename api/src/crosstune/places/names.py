"""Display names for places, in one format everywhere a place is shown.

A place named from coordinates is named by how well the position is known: a street
address when precise, its neighborhood when loose, its town when looser still. A place
picked in search keeps what was picked: a named place with its street and town, a street
address with its town, or a town. The town is the one on the mailing address.
"""

import re
import unicodedata
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Literal

from crosstune.vocabulary import LIMITS

PLACE_NAME_MAX = LIMITS["recordings"]["place_name"]
SAVED_ADDRESS_MAX = LIMITS["places"]["address"]
type PlaceKind = Literal["venue", "address", "town"]
STREET_MAX_ACCURACY_M = 50
NEIGHBORHOOD_MAX_ACCURACY_M = 500
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
# A street with its house number leading, as in the US, or trailing, as in much of Europe.
_HOUSE_FIRST = re.compile(r"^\d+[A-Za-z]?(?:-\d+)?\s+\D")
_HOUSE_LAST = re.compile(r"\D\s+\d+[A-Za-z]?$")


@dataclass(frozen=True)
class PickedName:
    """What a search result stores as a place's name, and the two lines that show it in a list.

    `kind` says whether the result is a venue, a street address, or a town. `address` is a
    venue's `street, town` line, as a saved location shows it, and None for the other kinds.
    """

    name: str
    title: str
    subtitle: str | None
    kind: PlaceKind
    address: str | None = None


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


def automatic_name(result: Mapping[str, object], accuracy_m: int | None) -> str | None:
    """Name the place a position falls in, as precisely as the position is known.

    A fix within `STREET_MAX_ACCURACY_M` meters, or a file location with no accuracy, is a
    street address. Within `NEIGHBORHOOD_MAX_ACCURACY_M` it is the neighborhood and the
    mailing-address town, or just the town when the neighborhood is the town itself or
    absent. Each tier falls back to the next when the result lacks what it needs.

    Args:
        result: An Apple Maps place object.
        accuracy_m: The fix's horizontal accuracy in meters, or None for a file location.

    Returns:
        str | None: The name cut to the length a recording stores, or None when nothing
            usable is present.
    """
    if accuracy_m is None or accuracy_m <= STREET_MAX_ACCURACY_M:
        name = street_address(result)
    elif accuracy_m <= NEIGHBORHOOD_MAX_ACCURACY_M:
        name = _neighborhood(result)
    else:
        name = None
    return _stored(name) if name else place_name(result)


def street_address(result: Mapping[str, object]) -> str | None:
    """The `street, town` line of a place, or None when it has no street.

    Args:
        result: An Apple Maps place object.

    Returns:
        str | None: The street address and the town, cut to the length a recording stores.
    """
    address = _address(result)
    street = _text(address.get("fullThoroughfare")) or _text(address.get("thoroughfare"))
    name = _joined(street, _town(result)) if street else None
    return _stored(name) if name else None


def _neighborhood(result: Mapping[str, object]) -> str | None:
    """The neighborhood with its mailing-address town, or None when it adds nothing.

    A candidate equal to the town's own locality is the town, not a neighborhood.
    """
    address = _address(result)
    town = _mailing_town(address, result.get("formattedAddressLines"))
    full = _town(result)
    if not town or not full:
        return None
    dependent = address.get("dependentLocalities")
    areas = address.get("areasOfInterest")
    candidates = (
        _text(dependent[0]) if isinstance(dependent, list) and dependent else None,
        _text(address.get("subLocality")),
        _text(areas[0]) if isinstance(areas, list) and areas else None,
    )
    for candidate in candidates:
        if candidate and candidate.casefold() != town.casefold():
            return _joined(candidate, full)
    return None


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
        return _picked(name, title, None, "town")
    title = lines[0]
    parts = _parts(", ".join(lines[1:]))
    country = parts.pop() if parts and _is_country(parts[-1], result) else None
    town = None if country else _structured_town(_address(result))
    parts = [part for part in (*parts, town) if part and part.casefold() != title.casefold()]
    kind = _suggestion_kind(title, parts, _address(result))
    rest = _joined(*parts, _kept(country, _US))
    return _picked(
        _joined(title, rest),
        title,
        _joined(*parts, _kept(country, home)),
        kind,
        address=rest if kind == "venue" else None,
    )


def _suggestion_kind(title: str, parts: list[str], address: Mapping[str, object]) -> PlaceKind:
    """Whether a two-line suggestion is a venue, a street address, or a town.

    Autocomplete results carry no category, so the structured street decides when there is one:
    a title that is the street is an address, any other title a venue. Without it, a second line
    that opens on a street marks a venue, whatever its name holds, such as `Terminal 5`; then a
    house number in the title marks an address.
    """
    street = _text(address.get("fullThoroughfare")) or _text(address.get("thoroughfare"))
    if street:
        return "address" if title.casefold() == street.casefold() else "venue"
    if _opens_on_street(parts, _text(address.get("postCode"))):
        return "venue"
    if any(char.isdigit() for char in title):
        return "address"
    return "town"


def _opens_on_street(parts: list[str], post_code: str | None) -> bool:
    """Whether a second line's first part is a street with its house number, and a town follows.

    A lone part, or one that opens on the structured postal code, is a postal code and its town,
    as in `10115 Berlin`.
    """
    first, *rest = parts or [""]
    if not rest:
        return False
    if post_code and first.startswith(post_code):
        return False
    return bool(_HOUSE_FIRST.match(first) or _HOUSE_LAST.search(first))


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


def _picked(
    name: str | None,
    title: str | None,
    subtitle: str | None,
    kind: PlaceKind,
    *,
    address: str | None = None,
) -> PickedName | None:
    stored = _stored(name) if name else None
    if not stored:
        return None
    return PickedName(
        name=stored,
        title=(_stored(title) if title else None) or stored,
        subtitle=_stored(subtitle) if subtitle else None,
        kind=kind,
        address=(_DANGLING.sub("", whole_characters(address, SAVED_ADDRESS_MAX)) or None)
        if address
        else None,
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
