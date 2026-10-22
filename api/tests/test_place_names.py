"""Place names follow one format everywhere."""

import pytest

from crosstune.places.names import (
    NEIGHBORHOOD_MAX_ACCURACY_M,
    STREET_MAX_ACCURACY_M,
    PickedName,
    automatic_name,
    place_name,
    street_address,
    suggestion_name,
)
from crosstune.vocabulary import LIMITS

PLACE_NAME_MAX = LIMITS["recordings"]["place_name"]


def test_us_place_uses_state_code() -> None:
    result = {
        "name": "Galax",
        "country": "United States",
        "countryCode": "US",
        "structuredAddress": {
            "locality": "Galax",
            "administrativeArea": "Virginia",
            "administrativeAreaCode": "VA",
        },
    }
    assert place_name(result) == "Galax, VA"


def test_place_outside_the_us_uses_country() -> None:
    result = {
        "name": "Ennis",
        "country": "Ireland",
        "countryCode": "IE",
        "structuredAddress": {"locality": "Ennis", "administrativeAreaCode": "CE"},
    }
    assert place_name(result) == "Ennis, Ireland"


def test_place_without_locality_uses_its_name() -> None:
    result = {"name": "Clifftop", "countryCode": "US", "structuredAddress": {}}
    assert place_name(result) == "Clifftop"


def test_nothing_usable_is_none() -> None:
    assert place_name({"structuredAddress": {"locality": " "}, "name": ""}) is None
    assert place_name({}) is None


def test_a_long_name_is_cut_to_the_stored_length() -> None:
    assert place_name({"name": "x" * 300}) == "x" * PLACE_NAME_MAX


def test_a_cut_leaves_no_dangling_separator() -> None:
    locality = "y" * (PLACE_NAME_MAX - 1)
    result = {
        "country": "Ireland",
        "countryCode": "IE",
        "structuredAddress": {"locality": locality},
    }
    assert place_name(result) == locality


def test_counts_code_points() -> None:
    # Each flag is one character of two code points.
    name = "🇮🇪" * 101
    assert place_name({"name": name}) == "🇮🇪" * 100


ZWJ = "‍"
FAMILY = f"👨{ZWJ}👩{ZWJ}👧"


def _cut(tail: str) -> str | None:
    """Name a place whose name puts `tail` across the stored length's end."""
    return place_name({"name": "a" * (PLACE_NAME_MAX - 1) + tail})


def test_a_cut_keeps_a_combining_mark_with_its_letter() -> None:
    assert _cut("é") == "a" * (PLACE_NAME_MAX - 1)


def test_a_cut_keeps_a_skin_tone_with_its_emoji() -> None:
    assert _cut("👍🏽") == "a" * (PLACE_NAME_MAX - 1)


def test_a_cut_keeps_a_variation_selector_with_its_character() -> None:
    assert _cut("❤️") == "a" * (PLACE_NAME_MAX - 1)


def test_a_cut_drops_a_whole_zwj_sequence() -> None:
    name = "a" * (PLACE_NAME_MAX - 3) + FAMILY
    assert place_name({"name": name}) == "a" * (PLACE_NAME_MAX - 3)


def test_a_cut_drops_a_whole_tag_sequence() -> None:
    scotland = "🏴\U000e0067\U000e0062\U000e0073\U000e0063\U000e0074\U000e007f"
    name = "a" * (PLACE_NAME_MAX - 3) + scotland
    assert place_name({"name": name}) == "a" * (PLACE_NAME_MAX - 3)


def test_a_cut_drops_half_a_flag() -> None:
    name = "a" * (PLACE_NAME_MAX - 3) + "🇮🇪🇫🇷"
    assert place_name({"name": name}) == "a" * (PLACE_NAME_MAX - 3) + "🇮🇪"


# Apple Maps answers for a Brooklyn street address: `locality` is New York for every borough,
# and the borough the mailing address names is in `subLocality`.
EASTERN_PKWY = {
    "name": "200 Eastern Pkwy",
    "country": "United States",
    "countryCode": "US",
    "structuredAddress": {
        "administrativeAreaCode": "NY",
        "locality": "New York",
        "subLocality": "Brooklyn",
        "postCode": "11238",
        "fullThoroughfare": "200 Eastern Pkwy",
    },
    "formattedAddressLines": ["200 Eastern Pkwy", "Brooklyn, NY  11238", "United States"],
}
# A Baltimore neighborhood whose mail goes to Brooklyn, MD.
BROOKLYN_MD = {
    "name": "Brooklyn Boosters Club",
    "poiCategory": "Nightlife",
    "country": "United States",
    "countryCode": "US",
    "structuredAddress": {
        "administrativeAreaCode": "MD",
        "locality": "Baltimore",
        "subLocality": "Brooklyn",
        "fullThoroughfare": "646 E Patapsco Ave",
    },
    "formattedAddressLines": ["646 E Patapsco Ave", "Brooklyn, MD  21225", "United States"],
}
# A neighborhood the mailing address does not name.
TENDERLOIN = {
    "name": "200 Larkin St",
    "country": "United States",
    "countryCode": "US",
    "structuredAddress": {
        "administrativeAreaCode": "CA",
        "locality": "San Francisco",
        "subLocality": "Tenderloin",
        "fullThoroughfare": "200 Larkin St",
    },
    "formattedAddressLines": ["200 Larkin St", "San Francisco, CA 94102", "United States"],
}


def test_a_town_is_the_one_the_mailing_address_names() -> None:
    assert place_name(EASTERN_PKWY) == "Brooklyn, NY"
    assert place_name(BROOKLYN_MD) == "Brooklyn, MD"


def test_a_neighborhood_the_mailing_address_skips_is_not_the_town() -> None:
    assert place_name(TENDERLOIN) == "San Francisco, CA"


def test_a_town_without_address_lines_is_the_locality() -> None:
    no_lines = {key: value for key, value in EASTERN_PKWY.items() if key != "formattedAddressLines"}
    assert place_name(no_lines) == "New York, NY"


def _in_neighborhood(**address: object) -> dict:
    return {
        **EASTERN_PKWY,
        "structuredAddress": {
            "administrativeAreaCode": "NY",
            "locality": "New York",
            "fullThoroughfare": "200 Eastern Pkwy",
            **address,
        },
        "formattedAddressLines": ["200 Eastern Pkwy", "New York, NY  11238", "United States"],
    }


def test_thresholds() -> None:
    assert (STREET_MAX_ACCURACY_M, NEIGHBORHOOD_MAX_ACCURACY_M) == (50, 500)


def test_precise_fix_names_the_street_address() -> None:
    assert automatic_name(EASTERN_PKWY, 12) == "200 Eastern Pkwy, Brooklyn, NY"
    assert automatic_name(EASTERN_PKWY, STREET_MAX_ACCURACY_M) == "200 Eastern Pkwy, Brooklyn, NY"


def test_file_location_names_the_street_address() -> None:
    assert automatic_name(EASTERN_PKWY, None) == "200 Eastern Pkwy, Brooklyn, NY"
    assert street_address(EASTERN_PKWY) == "200 Eastern Pkwy, Brooklyn, NY"


def test_loose_fix_names_the_neighborhood() -> None:
    assert automatic_name(TENDERLOIN, 120) == "Tenderloin, San Francisco, CA"
    assert (
        automatic_name(TENDERLOIN, NEIGHBORHOOD_MAX_ACCURACY_M) == "Tenderloin, San Francisco, CA"
    )


def test_loose_fix_in_a_borough_names_the_mailing_town() -> None:
    assert automatic_name(EASTERN_PKWY, 120) == "Brooklyn, NY"


def test_loose_fix_prefers_a_dependent_locality() -> None:
    result = _in_neighborhood(dependentLocalities=["Park Slope"], subLocality="Gowanus")
    assert automatic_name(result, 120) == "Park Slope, New York, NY"


def test_a_candidate_equal_to_the_town_is_skipped_for_the_next() -> None:
    result = _in_neighborhood(
        dependentLocalities=["new york"], subLocality="New York", areasOfInterest=["Central Park"]
    )
    assert automatic_name(result, 120) == "Central Park, New York, NY"


def test_loose_fix_without_sublocality_uses_area_of_interest() -> None:
    result = _in_neighborhood(areasOfInterest=["Prospect Park"])
    assert automatic_name(result, 120) == "Prospect Park, New York, NY"


def test_loose_fix_without_a_neighborhood_names_the_town() -> None:
    assert automatic_name(_in_neighborhood(), 120) == "New York, NY"


def test_very_loose_fix_names_the_town() -> None:
    assert automatic_name(EASTERN_PKWY, 800) == place_name(EASTERN_PKWY) == "Brooklyn, NY"
    assert automatic_name(EASTERN_PKWY, NEIGHBORHOOD_MAX_ACCURACY_M + 1) == "Brooklyn, NY"


def test_result_without_a_street_falls_back_to_the_town() -> None:
    result = {key: value for key, value in EASTERN_PKWY.items() if key != "structuredAddress"}
    assert street_address(result) is None
    assert automatic_name(EASTERN_PKWY | {"structuredAddress": {"locality": "Galax"}}, 5) == "Galax"
    assert automatic_name({"name": "Clifftop", "structuredAddress": {}}, None) == "Clifftop"


def test_non_us_street_address_carries_the_country() -> None:
    result = {
        "country": "Ireland",
        "countryCode": "IE",
        "structuredAddress": {"locality": "Ennis", "fullThoroughfare": "1 Abbey St"},
    }
    assert automatic_name(result, 10) == "1 Abbey St, Ennis, Ireland"


def test_non_us_neighborhood_carries_the_country() -> None:
    result = {
        "country": "Ireland",
        "countryCode": "IE",
        "structuredAddress": {"locality": "Dublin", "subLocality": "Ranelagh"},
    }
    assert automatic_name(result, 200) == "Ranelagh, Dublin, Ireland"


def test_automatic_name_is_cut_to_the_stored_length() -> None:
    result = EASTERN_PKWY | {
        "structuredAddress": EASTERN_PKWY["structuredAddress"] | {"fullThoroughfare": "x" * 300}
    }
    assert automatic_name(result, 5) == "x" * PLACE_NAME_MAX
    assert automatic_name({}, 5) is None


# Apple Maps type-ahead suggestions, as `/v1/searchAutocomplete` answers them.
def _suggestion(*lines: str, address: dict | None = None) -> dict:
    return {
        "displayLines": list(lines),
        "location": {"latitude": 40.68, "longitude": -74.0},
        "structuredAddress": address,
    }


JALOPY = _suggestion(
    "Jalopy Theatre And School of Music",
    "315 Columbia St, Brooklyn, NY 11231, United States",
    address={"locality": "Brooklyn", "subLocality": "Brooklyn", "administrativeAreaCode": "NY"},
)
KINGS_THEATRE = _suggestion(
    "Kings Theatre (Brooklyn)",
    "1027 Flatbush Ave, Brooklyn, NY  11226, United States",
    address={"locality": "New York", "subLocality": "Brooklyn", "administrativeAreaCode": "NY"},
)
BOOSTERS = _suggestion(
    "Brooklyn Boosters Club",
    "646 E Patapsco Ave, Brooklyn, MD  21225, United States",
    address={"locality": "Baltimore", "subLocality": "Brooklyn", "administrativeAreaCode": "MD"},
)
EASTERN = _suggestion("200 Eastern Pkwy", "Brooklyn, NY, United States")
CENTRE_ST = _suggestion("1038 Centre St", "Newton, MA, United States")
GALAX = _suggestion("Galax, VA", "United States")
ENNIS = _suggestion("Ennis", "Co. Clare, Ireland")
CAIRO = _suggestion("Cairo, Cairo, Egypt")
STREET_ONLY = _suggestion(
    "Town East Popcorn",
    "1220 N Town East Blvd",
    address={
        "locality": "Mesquite",
        "administrativeAreaCode": "TX",
        "fullThoroughfare": "1220 N Town East Blvd",
    },
)
US = "United States"


def test_a_suggested_venue_keeps_its_name_street_and_town() -> None:
    assert suggestion_name(JALOPY, US) == PickedName(
        name="Jalopy Theatre And School of Music, 315 Columbia St, Brooklyn, NY",
        title="Jalopy Theatre And School of Music",
        subtitle="315 Columbia St, Brooklyn, NY",
        kind="venue",
        address="315 Columbia St, Brooklyn, NY",
    )


def test_a_suggestion_names_the_mailing_address_town() -> None:
    assert suggestion_name(KINGS_THEATRE, US) == PickedName(
        name="Kings Theatre (Brooklyn), 1027 Flatbush Ave, Brooklyn, NY",
        title="Kings Theatre (Brooklyn)",
        subtitle="1027 Flatbush Ave, Brooklyn, NY",
        kind="venue",
        address="1027 Flatbush Ave, Brooklyn, NY",
    )
    named = suggestion_name(BOOSTERS, US)
    assert named is not None
    assert named.subtitle == "646 E Patapsco Ave, Brooklyn, MD"


def test_a_suggested_address_keeps_its_street_and_town() -> None:
    assert suggestion_name(EASTERN, US) == PickedName(
        name="200 Eastern Pkwy, Brooklyn, NY",
        title="200 Eastern Pkwy",
        subtitle="Brooklyn, NY",
        kind="address",
    )
    assert suggestion_name(CENTRE_ST, US) == PickedName(
        name="1038 Centre St, Newton, MA",
        title="1038 Centre St",
        subtitle="Newton, MA",
        kind="address",
    )


def test_a_suggested_town_is_its_town() -> None:
    assert suggestion_name(GALAX, US) == PickedName(
        name="Galax, VA", title="Galax, VA", subtitle=None, kind="town"
    )


def test_a_suggestion_abroad_keeps_its_country() -> None:
    assert suggestion_name(ENNIS, US) == PickedName(
        name="Ennis, Co. Clare, Ireland",
        title="Ennis",
        subtitle="Co. Clare, Ireland",
        kind="town",
    )


def test_the_rows_leave_out_the_account_country() -> None:
    assert suggestion_name(ENNIS, "Ireland") == PickedName(
        name="Ennis, Co. Clare, Ireland", title="Ennis", subtitle="Co. Clare", kind="town"
    )


def test_a_us_suggestion_stores_no_country_from_any_account() -> None:
    for home in ("Ireland", None):
        assert suggestion_name(JALOPY, home) == PickedName(
            name="Jalopy Theatre And School of Music, 315 Columbia St, Brooklyn, NY",
            title="Jalopy Theatre And School of Music",
            subtitle="315 Columbia St, Brooklyn, NY, United States",
            kind="venue",
            address="315 Columbia St, Brooklyn, NY",
        )


def test_a_one_line_suggestion_is_its_own_title() -> None:
    assert suggestion_name(CAIRO, US) == PickedName(
        name="Cairo, Cairo, Egypt", title="Cairo, Cairo, Egypt", subtitle=None, kind="town"
    )
    assert suggestion_name(CAIRO, "Egypt") == PickedName(
        name="Cairo, Cairo, Egypt", title="Cairo, Cairo", subtitle=None, kind="town"
    )
    one_line = _suggestion("Brooklyn Park, MN, United States")
    assert suggestion_name(one_line, US) == PickedName(
        name="Brooklyn Park, MN", title="Brooklyn Park, MN", subtitle=None, kind="town"
    )


def test_a_suggestion_whose_address_is_only_a_street_adds_its_town() -> None:
    assert suggestion_name(STREET_ONLY, US) == PickedName(
        name="Town East Popcorn, 1220 N Town East Blvd, Mesquite, TX",
        title="Town East Popcorn",
        subtitle="1220 N Town East Blvd, Mesquite, TX",
        kind="venue",
        address="1220 N Town East Blvd, Mesquite, TX",
    )


def test_a_suggestion_repeating_its_title_has_no_subtitle() -> None:
    terminal = _suggestion("Terminal 5", "Terminal 5")
    assert suggestion_name(terminal, US) == PickedName(
        name="Terminal 5", title="Terminal 5", subtitle=None, kind="address"
    )


def test_a_suggestion_with_nothing_usable_is_none() -> None:
    assert suggestion_name({}, US) is None
    assert suggestion_name({"displayLines": [" ", 5]}, US) is None
    assert suggestion_name({"displayLines": "Galax"}, US) is None


def test_a_long_suggestion_is_cut_without_a_dangling_separator_or_split_character() -> None:
    venue = _suggestion("v" * (PLACE_NAME_MAX - 1), "315 Columbia St, Brooklyn, NY, United States")
    named = suggestion_name(venue, US)
    assert named is not None
    assert named.name == "v" * (PLACE_NAME_MAX - 1)
    assert named.title == "v" * (PLACE_NAME_MAX - 1)
    accented = _suggestion("a" * (PLACE_NAME_MAX - 1) + "e\u0301", "Brooklyn, NY, United States")
    cut = suggestion_name(accented, US)
    assert cut is not None
    assert cut.name == "a" * (PLACE_NAME_MAX - 1)


def test_a_suggestion_abroad_keeps_its_country_in_a_venue_address() -> None:
    venue = _suggestion("The Cobblestone", "77 King St N, Dublin, D07 TP22, Ireland")
    named = suggestion_name(venue, "Ireland")
    assert named is not None
    assert named.kind == "venue"
    assert named.subtitle == "77 King St N, Dublin, D07 TP22"
    assert named.address == "77 King St N, Dublin, D07 TP22, Ireland"


def test_a_suggestion_whose_title_is_its_street_is_an_address() -> None:
    abroad = _suggestion(
        "Hauptstrasse 5",
        "10115 Berlin, Germany",
        address={"locality": "Berlin", "fullThoroughfare": "Hauptstrasse 5"},
    )
    named = suggestion_name(abroad, US)
    assert named is not None
    assert named.kind == "address"
    assert named.address is None


def test_a_suggestion_named_other_than_its_street_is_a_venue() -> None:
    venue = _suggestion(
        "Terminal 5",
        "610 W 56th St, New York, NY, United States",
        address={"locality": "New York", "fullThoroughfare": "610 W 56th St"},
    )
    named = suggestion_name(venue, US)
    assert named is not None
    assert named.kind == "venue"
    assert named.address == "610 W 56th St, New York, NY"


def test_a_venue_address_is_cut_to_the_saved_location_length() -> None:
    venue = _suggestion("Rex Theater", "1 " + "x" * 300 + " St, Galax, VA, United States")
    named = suggestion_name(venue, US)
    assert named is not None
    assert named.address is not None
    assert len(named.address) == LIMITS["places"]["address"]


@pytest.mark.parametrize(
    ("lines", "kind"),
    [
        (("Terminal 5", "610 W 56th St, New York, NY  10019, United States"), "venue"),
        (("9:30 Club", "815 V St NW, Washington, DC  20001, United States"), "venue"),
        (("Berghain", "Am Wriezener Bahnhof 1, 10243 Berlin, Germany"), "venue"),
        (("200 Eastern Pkwy", "Brooklyn, NY, United States"), "address"),
        (("Mitte", "10115 Berlin, Germany"), "town"),
    ],
)
def test_a_suggestion_without_a_structured_street_reads_its_second_line_first(
    lines: tuple[str, str], kind: str
) -> None:
    named = suggestion_name(_suggestion(*lines), US)
    assert named is not None
    assert named.kind == kind


def test_a_digit_named_venue_saves_its_own_name_with_its_street() -> None:
    named = suggestion_name(
        _suggestion("Terminal 5", "610 W 56th St, New York, NY  10019, United States"), US
    )
    assert named is not None
    assert named.title == "Terminal 5"
    assert named.address == "610 W 56th St, New York, NY"


def test_a_postal_code_leading_the_second_line_is_no_street() -> None:
    named = suggestion_name(
        _suggestion(
            "Mitte", "10115 Berlin, Germany", address={"postCode": "10115", "locality": "Berlin"}
        ),
        US,
    )
    assert named is not None
    assert named.kind == "town"
    lone = suggestion_name(
        _suggestion(
            "Kreuzberg", "10997 Berlin, Brandenburg, Germany", address={"postCode": "10997"}
        ),
        US,
    )
    assert lone is not None
    assert lone.kind == "town"
