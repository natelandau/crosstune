"""Loading the test data fixture and planning the rows it seeds."""

from __future__ import annotations

import itertools
import re
import shutil
import tomllib
from collections import Counter
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from crosstune.links.detect import detect_provider
from crosstune.ops.testdata.fixture import (
    DEFAULT_FIXTURES_DIR,
    Counts,
    FixtureError,
    RecordingMix,
    build_plan,
    load_fixture,
    resolve_fixture,
    split_recordings,
)
from crosstune.schemas.rows import DATA_SCHEMAS
from crosstune.sync.tables import TABLE_ORDER

if TYPE_CHECKING:
    from pathlib import Path

    from crosstune.ops.testdata.fixture import Fixture, Plan

STANDARD = DEFAULT_FIXTURES_DIR / "standard"
NOW = datetime(2026, 10, 10, 15, 30, tzinfo=UTC)
MIX = RecordingMix(microphone=5, upload=3, slippery_hill=2, unfiled=3)

MINIMAL = """\
seed = 1
first_created = 2025-06-01

[files]
audio = "recording.m4a"
image = "scan.jpg"
image_width = 10
image_height = 20

[recordings]
count = 2
microphone = 1
upload = 1
slippery_hill = 0
unfiled = 0
labels = ["Recording"]
slippery_hill_urls = []

[scans]
count = 0

[names]
first = ["Sally"]
second = ["Reel"]

[tunes]
count = 1
status = {status}
{extra}
"""


def _fixture(
    tmp_path: Path, extra: str = "", *, status: str = '["learning"]', media: bool = True
) -> Path:
    (tmp_path / "fixture.toml").write_text(MINIMAL.format(status=status, extra=extra))
    if media:
        (tmp_path / "recording.m4a").write_bytes(b"audio")
        (tmp_path / "scan.jpg").write_bytes(b"image")
    return tmp_path


def _rows(plan: Plan, table: str) -> list[dict]:
    return [change.data or {} for change in plan.changes if change.table == table]


def _plan(fixture: Fixture, **counts: int | None) -> Plan:
    return build_plan(fixture, Counts(**counts), now=NOW)


def test_standard_fixture_loads() -> None:
    """The bundled fixture loads with its counts and lists."""
    fixture = load_fixture(STANDARD)
    raw = tomllib.loads((STANDARD / "fixture.toml").read_text())

    assert fixture.tunes.count == raw["tunes"]["count"]
    assert fixture.lists is not None
    assert fixture.lists.count == raw["lists"]["count"]
    assert load_fixture(STANDARD / "fixture.toml") == fixture


def test_unknown_tunes_list_refused(tmp_path: Path) -> None:
    """A misspelled [tunes] list names the list."""
    folder = _fixture(tmp_path, 'kee = ["D"]')

    with pytest.raises(FixtureError, match=r"tunes.*kee"):
        load_fixture(folder)


def test_bad_mode_names_list_and_value(tmp_path: Path) -> None:
    """A mode outside the vocabulary names the list and the value."""
    folder = _fixture(tmp_path, 'modes = ["majr"]')

    with pytest.raises(FixtureError, match=r"tunes\.modes value 'majr'"):
        load_fixture(folder)


def test_bad_tuning_names_instrument(tmp_path: Path) -> None:
    """A tuning the instrument cannot hold names the instrument."""
    folder = _fixture(tmp_path, '[tunes.tunings]\nviolin = [{ tuning = "Standard", capo = 2 }]')

    with pytest.raises(FixtureError, match=r"tunes\.tunings\.violin"):
        load_fixture(folder)


@pytest.mark.parametrize("status", ['["mastered"]', "[]"])
def test_bad_status_list_refused(tmp_path: Path, status: str) -> None:
    """Statuses must come from the vocabulary, and there must be at least one."""
    folder = _fixture(tmp_path, status=status)

    with pytest.raises(FixtureError, match="status"):
        load_fixture(folder)


def test_tune_fields_picked_at_random_with_unset() -> None:
    """Each tune draws from every list, sometimes leaving the field unset, the same each run."""
    fixture = load_fixture(STANDARD)

    plans = [_plan(fixture, tunes=300) for _ in range(2)]
    tunes = _rows(plans[0], "tunes")
    user_tunes = _rows(plans[0], "user_tunes")

    assert {row["key"] for row in tunes} == {*fixture.tunes.key, None}
    assert {tuple(row["modes"]) for row in tunes} == {
        *((mode,) for mode in fixture.tunes.modes),
        (),
    }
    assert {row["tunings"].get("violin", {}).get("tuning") for row in tunes} == {
        *fixture.tunes.tunings["violin"],
        None,
    }
    assert {row["notes"] for row in user_tunes} == {*fixture.tunes.notes, None}
    assert {row["status"] for row in user_tunes} == set(fixture.tunes.status)
    assert tunes == _rows(plans[1], "tunes")
    assert [row["status"] for row in user_tunes] == [
        row["status"] for row in _rows(plans[1], "user_tunes")
    ]


def test_empty_lists_leave_fields_unset(tmp_path: Path) -> None:
    """A field with no list of values is never set."""
    fixture = load_fixture(_fixture(tmp_path))

    tune = _rows(_plan(fixture, recordings=0), "tunes")[0]
    user_tune = _rows(_plan(fixture, recordings=0), "user_tunes")[0]

    assert tune["key"] is None
    assert tune["modes"] == []
    assert tune["tunings"] == {}
    assert user_tune["status"] == "learning"
    assert user_tune["notes"] is None


def test_unknown_top_level_key_refused(tmp_path: Path) -> None:
    """A misspelled section key names the file and the key."""
    folder = _fixture(tmp_path)
    toml = folder / "fixture.toml"
    toml.write_text(toml.read_text().replace("[scans]\ncount", "[scans]\ncont"))

    with pytest.raises(FixtureError, match=r"fixture\.toml.*cont"):
        load_fixture(folder)


def test_missing_media_file_refused(tmp_path: Path) -> None:
    """A fixture whose audio or image file is missing is refused."""
    folder = _fixture(tmp_path, media=False)

    with pytest.raises(FixtureError, match=r"recording\.m4a"):
        load_fixture(folder)


def test_resolve_fixture(tmp_path: Path) -> None:
    """An existing path wins over a fixture name."""
    assert resolve_fixture(str(tmp_path)) == tmp_path
    assert resolve_fixture("standard") == DEFAULT_FIXTURES_DIR / "standard"


def test_split_default_mix() -> None:
    """The fixture's own count keeps its proportions."""
    assert split_recordings(10, MIX) == RecordingMix(5, 3, 2, 3)


def test_split_scales() -> None:
    """Other counts scale each proportion, with every source present from three up."""
    assert split_recordings(100, MIX) == RecordingMix(50, 30, 20, 30)
    assert split_recordings(3, MIX) == RecordingMix(1, 1, 1, 1)
    one = split_recordings(1, MIX)
    assert one.microphone + one.upload + one.slippery_hill == 1
    assert sorted([one.microphone, one.upload, one.slippery_hill]) == [0, 0, 1]
    assert split_recordings(0, MIX) == RecordingMix(0, 0, 0, 0)


def test_plan_default_counts() -> None:
    """The default plan seeds the default tunes, recordings, and scans."""
    fixture = load_fixture(STANDARD)
    plan = _plan(fixture)

    tunes = _rows(plan, "tunes")
    assert len(tunes) == fixture.tunes.count
    assert len(_rows(plan, "user_tunes")) == fixture.tunes.count
    recordings = _rows(plan, "recordings")
    assert Counter(row["source"] for row in recordings) == {
        "microphone": 5,
        "upload": 3,
        "import": 2,
    }
    assert all(row["origin"] == "slippery_hill" for row in recordings if row["source"] == "import")
    assert sum(row["tune_id"] is None for row in recordings) == 3
    assert len(plan.recordings) == 10
    tune_ids = [change.id for change in plan.changes if change.table == "tunes"]
    assert [row["tune_id"] for row in _rows(plan, "scans")] == [str(i) for i in tune_ids[:5]]
    assert len(plan.scans) == 5


def test_plan_tables_in_push_order() -> None:
    """Changes come parents first, as push applies them."""
    plan = _plan(load_fixture(STANDARD))
    order = [TABLE_ORDER.index(change.table) for change in plan.changes]

    assert order == sorted(order)
    assert {change.op for change in plan.changes} == {"upsert"}
    assert {change.updated_at for change in plan.changes} == {NOW}


def test_plan_unfiled_spread_across_kinds() -> None:
    """Every kind of recording has an unfiled one."""
    plan = _plan(load_fixture(STANDARD))
    unfiled = Counter(row["source"] for row in _rows(plan, "recordings") if row["tune_id"] is None)

    assert unfiled == {"microphone": 1, "upload": 1, "import": 1}


def test_plan_500_tunes_unique_and_repeatable() -> None:
    """Generated titles never repeat and the seed fixes them."""
    fixture = load_fixture(STANDARD)
    first = [row["title"] for row in _rows(_plan(fixture, tunes=500), "tunes")]
    second = [row["title"] for row in _rows(_plan(fixture, tunes=500), "tunes")]

    assert len(first) == 500
    assert len(set(first)) == 500
    assert first == second


def test_plan_taken_titles_skipped() -> None:
    """A title the account already holds is not planned again."""
    fixture = load_fixture(STANDARD)
    taken = _rows(_plan(fixture), "tunes")[0]["title"]
    plan = build_plan(fixture, Counts(), now=NOW, taken_titles=frozenset({taken}))
    titles = [row["title"] for row in _rows(plan, "tunes")]

    assert taken not in titles
    assert len(titles) == fixture.tunes.count


def test_plan_scans_wrap() -> None:
    """Scans fill the earliest tunes first and stack positions as they wrap."""
    plan = _plan(load_fixture(STANDARD), tunes=2, scans=5)
    tune_ids = [str(change.id) for change in plan.changes if change.table == "tunes"]
    placed = [(row["tune_id"], row["position"]) for row in _rows(plan, "scans")]

    assert sorted(position for tune, position in placed if tune == tune_ids[0]) == [0, 1, 2]
    assert sorted(position for tune, position in placed if tune == tune_ids[1]) == [0, 1]


def test_plan_scans_over_limit_refused() -> None:
    """More scans than the tunes can hold is refused."""
    with pytest.raises(FixtureError, match="cannot plan 21 scans on 1 tunes"):
        _plan(load_fixture(STANDARD), tunes=1, scans=21)


def test_plan_no_tunes() -> None:
    """With no tunes every recording is unfiled, and scans are refused."""
    fixture = load_fixture(STANDARD)
    plan = _plan(fixture, tunes=0, scans=0)

    assert _rows(plan, "tunes") == []
    assert _rows(plan, "lists") == []
    recordings = _rows(plan, "recordings")
    assert len(recordings) == 10
    assert all(row["tune_id"] is None for row in recordings)
    with pytest.raises(FixtureError):
        _plan(fixture, tunes=0, scans=1)


def test_plan_files_match_rows() -> None:
    """Each planned file carries its row's id, the fixture's file, and the row's source."""
    fixture = load_fixture(STANDARD)
    plan = _plan(fixture)
    recordings = {c.id: c.data for c in plan.changes if c.table == "recordings"}

    assert {f.id for f in plan.recordings} == set(recordings)
    for planned in plan.recordings:
        assert planned.path == STANDARD / "recording.m4a"
        assert planned.source == (recordings[planned.id] or {})["source"]
    assert {f.path for f in plan.scans} == {STANDARD / "scan.jpg"}
    assert {f.source for f in plan.scans} == {None}


def test_plan_lists_draw_names_and_sizes() -> None:
    """Lists take different names from the fixture and hold min_size to max_size tunes."""
    fixture = load_fixture(STANDARD)
    assert fixture.lists is not None
    plan = _plan(fixture, tunes=200)
    names = [row["name"] for row in _rows(plan, "lists")]
    items = Counter(row["list_id"] for row in _rows(plan, "list_items"))

    assert len(names) == fixture.lists.count
    assert len(set(names)) == len(names)
    assert set(names) <= set(fixture.lists.names)
    assert len(items) == fixture.lists.count
    assert all(fixture.lists.min_size <= size <= fixture.lists.max_size for size in items.values())
    assert names == [row["name"] for row in _rows(_plan(fixture, tunes=200), "lists")]


def test_plan_lists_past_the_names_get_tags() -> None:
    """More lists than names reuse names with a random five-character tag, all different."""
    fixture = load_fixture(STANDARD)
    assert fixture.lists is not None
    count = len(set(fixture.lists.names)) + 15

    names = [row["name"] for row in _rows(_plan(fixture, lists=count), "lists")]

    assert len(names) == count
    assert len(set(names)) == count
    tagged = [name for name in names if name not in fixture.lists.names]
    assert len(tagged) == 15
    for name in tagged:
        base, tag = name.rsplit(" ", 1)
        assert base in fixture.lists.names
        assert re.fullmatch(r"[a-z0-9]{5}", tag)
    assert names == [row["name"] for row in _rows(_plan(fixture, lists=count), "lists")]


def test_plan_list_count_override() -> None:
    """The lists count overrides the fixture's, down to none."""
    fixture = load_fixture(STANDARD)

    assert len(_rows(_plan(fixture, lists=2), "lists")) == 2
    assert _rows(_plan(fixture, lists=0), "lists") == []


def test_plan_lists_without_names_refused(tmp_path: Path) -> None:
    """Asking for lists from a fixture with no [lists] names is refused."""
    with pytest.raises(FixtureError, match="no \\[lists\\] names"):
        _plan(load_fixture(_fixture(tmp_path)), lists=1)


def test_plan_list_sizes_capped_by_tunes() -> None:
    """A list never holds more tunes than the plan makes."""
    plan = _plan(load_fixture(STANDARD), tunes=2, scans=0)

    assert set(Counter(row["list_id"] for row in _rows(plan, "list_items")).values()) == {2}


@pytest.mark.parametrize(
    ("lists", "match"),
    [
        ("count = 1\nnames = []\nmin_size = 1\nmax_size = 2", "names"),
        ('count = 1\nnames = ["Jigs"]\nmin_size = 5\nmax_size = 4', "min_size 5"),
    ],
)
def test_bad_lists_refused(tmp_path: Path, lists: str, match: str) -> None:
    """No names to draw from, or sizes out of order, are refused."""
    folder = _fixture(tmp_path)
    toml = folder / "fixture.toml"
    toml.write_text(toml.read_text().replace("[tunes]", f"[lists]\n{lists}\n\n[tunes]"))

    with pytest.raises(FixtureError, match=match):
        load_fixture(folder)


def test_slippery_hill_urls_detected() -> None:
    """Every Slippery-Hill URL in the fixture is one the import job accepts."""
    fixture = load_fixture(STANDARD)

    assert fixture.recordings.slippery_hill_urls
    for url in fixture.recordings.slippery_hill_urls:
        assert detect_provider(url)[0] == "slippery_hill"


def test_plan_data_validates() -> None:
    """Every planned row passes the push schema for its table."""
    for counts in ({}, {"tunes": 500, "recordings": 40, "scans": 30}, {"tunes": 0, "scans": 0}):
        plan = _plan(load_fixture(STANDARD), **counts)
        for change in plan.changes:
            DATA_SCHEMAS[change.table].model_validate(change.data)


def test_copied_fixture_folder_loads(tmp_path: Path) -> None:
    """A fixture folder copied elsewhere loads from its new place."""
    copy = tmp_path / "copy"
    shutil.copytree(STANDARD, copy)

    assert load_fixture(copy).files.audio_path == copy / "recording.m4a"


def test_split_rounds_half_up() -> None:
    """A half unfiled recording rounds up, not to the even neighbor."""
    assert split_recordings(5, RecordingMix(1, 1, 0, 1)).unfiled == 3


def test_split_zero_weight_stays_zero() -> None:
    """A source with no proportion gets no recordings at any count."""
    split = split_recordings(10, RecordingMix(microphone=1, upload=1, slippery_hill=0, unfiled=0))

    assert split.slippery_hill == 0
    assert split.microphone + split.upload == 10


def test_plan_created_never_passes_now() -> None:
    """Many tunes squeeze closer together so the last is created by now."""
    fixture = load_fixture(STANDARD)
    created = [
        datetime.fromisoformat(row["created_at"])
        for row in _rows(_plan(fixture, tunes=500), "tunes")
    ]

    assert created == sorted(created)
    assert len(set(created)) == 500
    assert created[-1] <= NOW


def test_plan_created_a_day_apart_when_they_fit() -> None:
    """A few tunes are created a day apart from the fixture's first date."""
    fixture = load_fixture(STANDARD)
    created = [datetime.fromisoformat(row["created_at"]) for row in _rows(_plan(fixture), "tunes")]

    assert created[0].date() == fixture.first_created
    assert {b - a for a, b in itertools.pairwise(created)} == {timedelta(days=1)}


def test_plan_lists_start_after_existing() -> None:
    """Planned lists take positions after the ones the account already holds."""
    fixture = load_fixture(STANDARD)
    plan = build_plan(fixture, Counts(), now=NOW, list_start=4)

    assert fixture.lists is not None
    assert [row["position"] for row in _rows(plan, "lists")] == list(
        range(4, 4 + fixture.lists.count)
    )


def test_plan_lists_skip_taken_names() -> None:
    """Planned lists never reuse a name the account already holds."""
    fixture = load_fixture(STANDARD)
    assert fixture.lists is not None
    taken = frozenset(fixture.lists.names[:3])

    plan = build_plan(fixture, Counts(), now=NOW, taken_list_names=taken)
    names = [row["name"] for row in _rows(plan, "lists")]

    assert len(names) == fixture.lists.count
    assert not taken & set(names)
