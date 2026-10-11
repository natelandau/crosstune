"""Load a test data fixture and plan the rows it seeds.

A fixture is a folder holding `fixture.toml`, one audio file, and one scan image. The
planner turns a fixture and the requested counts into sync changes and the files to
upload for them. It never touches the database or the network.
"""

from __future__ import annotations

import itertools
import math
import random
import string
import tomllib
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    ValidationError,
    field_validator,
    model_validator,
)

from crosstune.db.base import new_uuid7
from crosstune.links.detect import detect_provider
from crosstune.schemas.common import Change
from crosstune.schemas.rows import DATA_SCHEMAS
from crosstune.sync.tables import TABLE_ORDER
from crosstune.vocabulary import (
    MAX_SCANS_PER_TUNE,
    RecordingOrigin,
    RecordingPrecision,
    RecordingSource,
    TuneStatus,
)

if TYPE_CHECKING:
    from collections.abc import Sequence

    from crosstune.vocabulary import TableName

DEFAULT_FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures"
FIXTURE_FILE = "fixture.toml"
# Midday keeps a tune's created date the same in every timezone a client shows it in.
CREATED_TIME = time(12, tzinfo=UTC)
# Any valid timestamp: only the tune's other fields are being checked.
CHECK_CREATED_AT = datetime(2000, 1, 1, tzinfo=UTC)
# The [tunes] lists that fill a tune's fields, in the order they are picked.
TUNE_FACETS = (
    "genre",
    "tune_type",
    "key",
    "modes",
    "time_signature",
    "part_structure",
    "composer",
    "alternate_titles",
    "lyrics",
    "is_crooked",
)
# Fields the schema holds as a list, which a pick fills with one entry.
LIST_FACETS = frozenset({"modes", "alternate_titles"})
# A list past the fixture's names reuses one with this many random characters appended.
LIST_TAG_LENGTH = 5
LIST_TAG_ALPHABET = string.ascii_lowercase + string.digits

NonNegative = Annotated[int, Field(ge=0)]


class FixtureError(Exception):
    """A fixture that cannot be loaded, or counts it cannot plan."""


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class FilesConfig(_Strict):
    """The media every planned recording and scan uploads."""

    audio: str = Field(min_length=1)
    image: str = Field(min_length=1)
    image_width: int = Field(gt=0)
    image_height: int = Field(gt=0)


@dataclass(frozen=True)
class MediaFiles:
    """The fixture's media, resolved against its folder."""

    audio_path: Path
    image_path: Path
    image_width: int
    image_height: int


class RecordingsConfig(_Strict):
    """The default recording count and how it divides between kinds."""

    count: NonNegative
    microphone: NonNegative
    upload: NonNegative
    slippery_hill: NonNegative
    unfiled: NonNegative
    labels: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)
    slippery_hill_urls: list[str] = []

    @field_validator("slippery_hill_urls")
    @classmethod
    def _slippery_hill(cls, urls: list[str]) -> list[str]:
        for url in urls:
            if detect_provider(url)[0] != "slippery_hill":
                msg = f"{url!r} is not a Slippery-Hill file URL"
                raise ValueError(msg)
        return urls

    @property
    def mix(self) -> RecordingMix:
        """The proportions `split_recordings` scales."""
        return RecordingMix(
            microphone=self.microphone,
            upload=self.upload,
            slippery_hill=self.slippery_hill,
            unfiled=self.unfiled,
        )


class ScansConfig(_Strict):
    """The default scan count."""

    count: NonNegative


class NamesConfig(_Strict):
    """The parts tune titles are built from."""

    first: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)
    second: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)


class ListsConfig(_Strict):
    """The default list count, the names lists draw from, and how many tunes each holds."""

    count: NonNegative
    names: list[Annotated[str, Field(min_length=1)]] = Field(min_length=1)
    min_size: NonNegative
    max_size: NonNegative

    @model_validator(mode="after")
    def _sizes_in_order(self) -> ListsConfig:
        if self.min_size > self.max_size:
            msg = f"min_size {self.min_size} is more than max_size {self.max_size}"
            raise ValueError(msg)
        return self


TuningChoice = str | dict[str, Any]


class TunesConfig(_Strict):
    """The default tune count, and the values each tune's fields are drawn from."""

    count: NonNegative
    status: list[TuneStatus] = Field(min_length=1)
    genre: list[str] = []
    tune_type: list[str] = []
    key: list[str] = []
    modes: list[str] = []
    time_signature: list[str] = []
    part_structure: list[str] = []
    composer: list[str] = []
    alternate_titles: list[str] = []
    lyrics: list[str] = []
    is_crooked: list[bool] = []
    notes: list[str] = []
    tunings: dict[str, list[TuningChoice]] = {}

    def tuning_choices(self) -> dict[str, list[dict[str, Any]]]:
        """Each instrument's tunings, with a bare name read as `{tuning = name}`."""
        return {
            instrument: [
                {"tuning": choice} if isinstance(choice, str) else choice for choice in choices
            ]
            for instrument, choices in self.tunings.items()
        }


class _FixtureFile(_Strict):
    seed: int
    first_created: date
    files: FilesConfig
    recordings: RecordingsConfig
    scans: ScansConfig
    names: NamesConfig
    tunes: TunesConfig
    lists: ListsConfig | None = None


@dataclass(frozen=True)
class Fixture:
    """A loaded, validated fixture."""

    path: Path
    seed: int
    first_created: date
    files: MediaFiles
    recordings: RecordingsConfig
    scans: ScansConfig
    names: NamesConfig
    lists: ListsConfig | None
    tunes: TunesConfig


@dataclass(frozen=True)
class RecordingMix:
    """How many recordings of each kind, and how many of them are unfiled."""

    microphone: int
    upload: int
    slippery_hill: int
    unfiled: int


@dataclass(frozen=True)
class Counts:
    """How many of each row to seed; None takes the fixture's count."""

    tunes: int | None = None
    recordings: int | None = None
    scans: int | None = None
    lists: int | None = None


@dataclass(frozen=True)
class PlannedFile:
    """A file to upload for a planned recording or scan row."""

    id: uuid.UUID
    path: Path
    source: RecordingSource | None


@dataclass(frozen=True)
class Plan:
    """The changes to push, parents first, and the files their rows upload."""

    changes: list[Change]
    recordings: list[PlannedFile]
    scans: list[PlannedFile]


def resolve_fixture(name_or_path: str) -> Path:
    """Find a fixture given either its path or the name of a bundled fixture.

    Args:
        name_or_path: A fixture folder or `fixture.toml`, or a folder name under
            `DEFAULT_FIXTURES_DIR`.

    Returns:
        Path: The path as given when it exists, else the bundled fixture's folder.
    """
    path = Path(name_or_path)
    return path if path.exists() else DEFAULT_FIXTURES_DIR / name_or_path


def _describe(error: ValidationError) -> str:
    return "; ".join(
        f"{'.'.join(str(part) for part in item['loc']) or 'value'}: {item['msg']}"
        for item in error.errors()
    )


def _facet_value(facet: str, value: Any) -> Any:
    return [value] if facet in LIST_FACETS else value


def _check_tune_choices(toml: Path, tunes: TunesConfig) -> None:
    """Refuse a [tunes] value the push schema would, naming the list and the value."""
    checks: list[tuple[str, Any, TableName, dict[str, Any]]] = [
        (f"tunes.{facet}", value, "tunes", {facet: _facet_value(facet, value)})
        for facet in TUNE_FACETS
        for value in getattr(tunes, facet)
    ]
    checks += [
        (f"tunes.tunings.{instrument}", choice, "tunes", {"tunings": {instrument: choice}})
        for instrument, choices in tunes.tuning_choices().items()
        for choice in choices
    ]
    checks += [
        ("tunes.notes", note, "user_tunes", {"notes": note, "status": TuneStatus.LEARNING})
        for note in tunes.notes
    ]
    base: dict[TableName, dict[str, Any]] = {
        "tunes": {"title": "Check", "created_at": CHECK_CREATED_AT},
        "user_tunes": {"created_at": CHECK_CREATED_AT, "tune_id": uuid.UUID(int=0)},
    }
    for where, value, table, fields in checks:
        try:
            DATA_SCHEMAS[table].model_validate({**base[table], **fields})
        except ValidationError as error:
            msg = f"{toml}: {where} value {value!r}: {_describe(error)}"
            raise FixtureError(msg) from error


def load_fixture(path: Path) -> Fixture:
    """Read and validate a fixture so planning never meets a bad value.

    Args:
        path: A fixture folder, or the `fixture.toml` inside one.

    Returns:
        Fixture: The validated fixture, with its media paths resolved from its folder.

    Raises:
        FixtureError: The file is missing or malformed, a key is unknown, a [tunes] value
            fails the push schema, or a media file is missing. The message names the file,
            and for a [tunes] value its list and the value.
    """
    toml = path / FIXTURE_FILE if path.is_dir() else path
    try:
        raw = tomllib.loads(toml.read_text(encoding="utf-8"))
    except OSError as error:
        msg = f"{toml}: cannot read the fixture: {error}"
        raise FixtureError(msg) from error
    except tomllib.TOMLDecodeError as error:
        msg = f"{toml}: invalid TOML: {error}"
        raise FixtureError(msg) from error
    try:
        parsed = _FixtureFile.model_validate(raw)
    except ValidationError as error:
        msg = f"{toml}: {_describe(error)}"
        raise FixtureError(msg) from error

    files = MediaFiles(
        audio_path=toml.parent / parsed.files.audio,
        image_path=toml.parent / parsed.files.image,
        image_width=parsed.files.image_width,
        image_height=parsed.files.image_height,
    )
    for media in (files.audio_path, files.image_path):
        if not media.is_file():
            msg = f"{toml}: media file {media} does not exist"
            raise FixtureError(msg)
    if parsed.recordings.slippery_hill and not parsed.recordings.slippery_hill_urls:
        msg = f"{toml}: recordings.slippery_hill_urls is empty but slippery_hill is not 0"
        raise FixtureError(msg)
    if parsed.recordings.mix == RecordingMix(0, 0, 0, parsed.recordings.unfiled):
        msg = f"{toml}: recordings needs a nonzero microphone, upload, or slippery_hill"
        raise FixtureError(msg)
    _check_tune_choices(toml, parsed.tunes)

    return Fixture(
        path=toml,
        seed=parsed.seed,
        first_created=parsed.first_created,
        files=files,
        recordings=parsed.recordings,
        scans=parsed.scans,
        names=parsed.names,
        lists=parsed.lists,
        tunes=parsed.tunes,
    )


def split_recordings(n: int, mix: RecordingMix) -> RecordingMix:
    """Scale the fixture's recording proportions to `n` recordings.

    Uses largest-remainder rounding so the three sources sum to `n`. From three
    recordings up, every source with a nonzero proportion gets at least one.

    Args:
        n: How many recordings to plan.
        mix: The fixture's proportions.

    Returns:
        RecordingMix: The count of each source, and how many of all `n` are unfiled.
    """
    weights = [mix.microphone, mix.upload, mix.slippery_hill]
    total = sum(weights)
    if n == 0 or total == 0:
        return RecordingMix(microphone=0, upload=0, slippery_hill=0, unfiled=0)
    quotas = [n * weight / total for weight in weights]
    counts = [int(quota) for quota in quotas]
    by_remainder = sorted(range(3), key=lambda i: quotas[i] - counts[i], reverse=True)
    for i in by_remainder[: n - sum(counts)]:
        counts[i] += 1
    if n >= len(weights):
        for i, weight in enumerate(weights):
            if weight and not counts[i]:
                counts[counts.index(max(counts))] -= 1
                counts[i] = 1
    return RecordingMix(
        microphone=counts[0],
        upload=counts[1],
        slippery_hill=counts[2],
        # Half up, where round() would take a .5 to the even neighbor.
        unfiled=min(n, math.floor(n * mix.unfiled / total + 0.5)),
    )


class _Planner:
    """Build one plan's rows, keeping each table's changes apart until they are ordered."""

    def __init__(self, fixture: Fixture, now: datetime, list_start: int) -> None:
        self.fixture = fixture
        self.now = now
        self.list_start = list_start
        self.rows: dict[TableName, list[Change]] = {table: [] for table in TABLE_ORDER}
        self.recordings: list[PlannedFile] = []
        self.scans: list[PlannedFile] = []

    def add(self, table: TableName, fields: dict[str, Any]) -> uuid.UUID:
        """Validate a row's fields against its push schema and queue the upsert."""
        row_id = new_uuid7()
        data = DATA_SCHEMAS[table].model_validate(fields).model_dump(mode="json")
        self.rows[table].append(
            Change(table=table, op="upsert", id=row_id, updated_at=self.now, data=data)
        )
        return row_id

    def plan(self) -> Plan:
        return Plan(
            changes=[change for table in TABLE_ORDER for change in self.rows[table]],
            recordings=self.recordings,
            scans=self.scans,
        )


def _titles(fixture: Fixture, count: int, taken: frozenset[str]) -> list[str]:
    combos = [
        f"{first} {second}"
        for first, second in itertools.product(
            dict.fromkeys(fixture.names.first), dict.fromkeys(fixture.names.second)
        )
    ]
    random.Random(fixture.seed).shuffle(combos)  # noqa: S311 - repeatable titles, not secrets
    chosen = list(itertools.islice((title for title in combos if title not in taken), count))
    if len(chosen) < count:
        msg = (
            f"{fixture.path}: [names] gives too few new titles for {count} tunes; "
            f"add more first or second parts"
        )
        raise FixtureError(msg)
    return chosen


def _pick[T](rng: random.Random, choices: Sequence[T]) -> T | None:
    """Pick one choice, or None as often as any one choice; never set from an empty list."""
    return rng.choice([*choices, None]) if choices else None


def _tune_fields(rng: random.Random, tunes: TunesConfig) -> dict[str, Any]:
    fields: dict[str, Any] = {}
    for facet in TUNE_FACETS:
        value = _pick(rng, getattr(tunes, facet))
        if value is not None:
            fields[facet] = _facet_value(facet, value)
    tunings = {
        instrument: choice
        for instrument, choices in tunes.tuning_choices().items()
        if (choice := _pick(rng, choices)) is not None
    }
    if tunings:
        fields["tunings"] = tunings
    return fields


def _plan_tunes(
    planner: _Planner, count: int, taken: frozenset[str]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    fixture = planner.fixture
    planned: list[tuple[uuid.UUID, uuid.UUID]] = []
    # Its own stream, so editing a [tunes] list never reshuffles titles.
    rng = random.Random(fixture.seed)  # noqa: S311 - repeatable picks, not secrets
    first = datetime.combine(fixture.first_created, CREATED_TIME)
    # A day apart, or closer when that many days would run past now.
    step = max(timedelta(0), min(timedelta(days=1), (planner.now - first) / max(count, 1)))
    for i, title in enumerate(_titles(fixture, count, taken)):
        created = first + step * i
        tune_id = planner.add(
            "tunes",
            {**_tune_fields(rng, fixture.tunes), "title": title, "created_at": created},
        )
        user_tune_id = planner.add(
            "user_tunes",
            {
                "created_at": created,
                "tune_id": tune_id,
                "status": rng.choice(fixture.tunes.status),
                "notes": _pick(rng, fixture.tunes.notes),
            },
        )
        planned.append((tune_id, user_tune_id))
    return planned


def _list_names(
    rng: random.Random, names: Sequence[str], count: int, taken: frozenset[str]
) -> list[str]:
    """Draw `count` names not in `taken`, suffixing a random tag once every name is used."""
    base = list(dict.fromkeys(names))
    pool = [name for name in base if name not in taken]
    rng.shuffle(pool)
    chosen = pool[:count]
    used = {*taken, *chosen}
    while len(chosen) < count:
        tag = "".join(rng.choices(LIST_TAG_ALPHABET, k=LIST_TAG_LENGTH))
        name = f"{rng.choice(base)} {tag}"
        if name not in used:
            used.add(name)
            chosen.append(name)
    return chosen


def _plan_lists(
    planner: _Planner,
    count: int,
    user_tune_ids: Sequence[uuid.UUID],
    taken: frozenset[str],
) -> None:
    config = planner.fixture.lists
    if config is None or not count or not user_tune_ids:
        return
    # Its own stream, so editing [tunes] never changes the lists.
    rng = random.Random(planner.fixture.seed)  # noqa: S311 - repeatable picks, not secrets
    names = _list_names(rng, config.names, count, taken)
    # One running cursor, so successive lists hold different tunes until the tunes run out.
    cursor = itertools.cycle(user_tune_ids)
    for position, name in enumerate(names, start=planner.list_start):
        list_id = planner.add(
            "lists", {"created_at": planner.now, "name": name, "position": position}
        )
        size = rng.randint(config.min_size, config.max_size)
        for item in range(min(size, len(user_tune_ids))):
            planner.add(
                "list_items",
                {
                    "created_at": planner.now,
                    "list_id": list_id,
                    "user_tune_id": next(cursor),
                    "position": item,
                },
            )


def _unfiled(kinds: list[RecordingSource], count: int) -> set[int]:
    """Pick `count` recordings to leave unfiled, one from each kind in turn."""
    by_kind = {kind: [i for i, k in enumerate(kinds) if k == kind] for kind in dict.fromkeys(kinds)}
    picked: set[int] = set()
    count = min(count, len(kinds))
    while len(picked) < count:
        for indexes in by_kind.values():
            if indexes and len(picked) < count:
                picked.add(indexes.pop())
    return picked


def _plan_recordings(planner: _Planner, count: int, tune_ids: Sequence[uuid.UUID]) -> None:
    config = planner.fixture.recordings
    split = split_recordings(count, config.mix)
    kinds = (
        [RecordingSource.MICROPHONE] * split.microphone
        + [RecordingSource.UPLOAD] * split.upload
        + [RecordingSource.IMPORT] * split.slippery_hill
    )
    unfiled = set(range(len(kinds))) if not tune_ids else _unfiled(kinds, split.unfiled)
    urls = itertools.cycle(config.slippery_hill_urls)
    today = planner.now.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    per_tune: dict[uuid.UUID, int] = {}
    filed = 0
    for i, source in enumerate(kinds):
        tune_id: uuid.UUID | None = None
        if i not in unfiled:
            tune_id = tune_ids[filed % len(tune_ids)]
            filed += 1
        position = 0
        if tune_id is not None:
            position = per_tune.get(tune_id, 0)
            per_tune[tune_id] = position + 1
        imported = source == RecordingSource.IMPORT
        recording_id = planner.add(
            "recordings",
            {
                "created_at": planner.now,
                "tune_id": tune_id,
                "label": f"{config.labels[i % len(config.labels)]} {i + 1}",
                "source": source,
                "origin": RecordingOrigin.SLIPPERY_HILL if imported else RecordingOrigin.OWN,
                "origin_url": next(urls) if imported else None,
                "added_at": planner.now,
                "recorded_precision": RecordingPrecision.DAY,
                "recorded_at": today - timedelta(days=i),
                "position": position,
            },
        )
        planner.recordings.append(
            PlannedFile(id=recording_id, path=planner.fixture.files.audio_path, source=source)
        )


def _plan_scans(planner: _Planner, count: int, tune_ids: Sequence[uuid.UUID]) -> None:
    files = planner.fixture.files
    for j in range(count):
        scan_id = planner.add(
            "scans",
            {
                "created_at": planner.now,
                "tune_id": tune_ids[j % len(tune_ids)],
                "position": j // len(tune_ids),
                "width": files.image_width,
                "height": files.image_height,
            },
        )
        planner.scans.append(PlannedFile(id=scan_id, path=files.image_path, source=None))


def build_plan(
    fixture: Fixture,
    counts: Counts,
    *,
    now: datetime,
    taken_titles: frozenset[str] = frozenset(),
    taken_list_names: frozenset[str] = frozenset(),
    list_start: int = 0,
) -> Plan:
    """Plan every row and file a seed writes, so the seeder only has to apply it.

    Args:
        fixture: The loaded fixture.
        counts: How many tunes, recordings, scans, and lists to plan.
        now: The timestamp every change carries and new rows are created at.
        taken_titles: Titles the account already holds, which the plan never reuses.
        taken_list_names: List names the account already holds, which the plan never reuses.
        list_start: The position of the first planned list, after any the account holds.

    Returns:
        Plan: Upserts in push order, and the recording and scan files to upload.

    Raises:
        FixtureError: A count is negative, scans are asked for with no tunes or exceed
            what the tunes can hold, or the names run out of new titles.
    """
    tune_count = fixture.tunes.count if counts.tunes is None else counts.tunes
    recording_count = fixture.recordings.count if counts.recordings is None else counts.recordings
    scan_count = fixture.scans.count if counts.scans is None else counts.scans
    default_lists = fixture.lists.count if fixture.lists else 0
    list_count = default_lists if counts.lists is None else counts.lists
    for label, value in (
        ("tunes", tune_count),
        ("recordings", recording_count),
        ("scans", scan_count),
        ("lists", list_count),
    ):
        if value < 0:
            msg = f"{label} must be 0 or more, got {value}"
            raise FixtureError(msg)
    if list_count and fixture.lists is None:
        msg = f"cannot plan {list_count} lists: {fixture.path} has no [lists] names"
        raise FixtureError(msg)
    if scan_count and not tune_count:
        msg = f"cannot plan {scan_count} scans with no tunes: every scan belongs to a tune"
        raise FixtureError(msg)
    if scan_count > tune_count * MAX_SCANS_PER_TUNE:
        msg = (
            f"cannot plan {scan_count} scans on {tune_count} tunes: "
            f"a tune holds at most {MAX_SCANS_PER_TUNE}"
        )
        raise FixtureError(msg)

    planner = _Planner(fixture, now, list_start)
    planned = _plan_tunes(planner, tune_count, taken_titles)
    tune_ids = [tune_id for tune_id, _ in planned]
    _plan_lists(
        planner,
        list_count,
        [user_tune_id for _, user_tune_id in planned],
        taken_list_names,
    )
    _plan_recordings(planner, recording_count, tune_ids)
    _plan_scans(planner, scan_count, tune_ids)
    return planner.plan()
