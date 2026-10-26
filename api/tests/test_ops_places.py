"""The rename-automatic operator command."""

from __future__ import annotations

from typing import TYPE_CHECKING

import httpx2
import pytest
from sqlalchemy import select

from crosstune.db.engine import make_sessionmaker
from crosstune.models import Recording
from crosstune.ops import places as ops_places
from crosstune.places.maps import MapsBusyError, MapsError
from tests.test_jobs import add_recording, make_user

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

LAT, LON = 36.661234, -80.923912


class FakeMaps:
    """Names by a table of answers, recording each lookup and running a hook before it answers."""

    def __init__(self, names: dict[str, str | Exception | None], hook=None) -> None:
        self.names = names
        self.hook = hook
        self.calls: list[tuple[float, float, int | None]] = []

    async def reverse_name(self, client, lat, lon, *, accuracy_m, timeout):  # noqa: ASYNC109
        self.calls.append((lat, lon, accuracy_m))
        if self.hook is not None:
            await self.hook()
        answer = self.names[f"{lat}"]
        if isinstance(answer, Exception):
            raise answer
        return answer


async def _named_recording(session: AsyncSession, user, **fields) -> Recording:
    fields = {
        "place_lat": LAT,
        "place_lon": LON,
        "place_name": "Galax, VA",
        "place_origin": "device",
        "place_accuracy_m": 10,
        **fields,
    }
    return await add_recording(session, user, "ready", **fields)


async def _run(engine, maps, sleeps=None, **options) -> ops_places.RenameCounts:
    async def sleep(seconds: float) -> None:
        if sleeps is not None:
            sleeps.append(seconds)

    return await ops_places.rename_automatic(
        make_sessionmaker(engine),
        maps,
        httpx2.AsyncClient(),
        timeout=5,
        per_second=options.pop("per_second", 2),
        dry_run=options.pop("dry_run", False),
        sleep=sleep,
    )


async def _fresh(session: AsyncSession, rec: Recording) -> Recording:
    return (
        await session.scalars(
            select(Recording)
            .where(Recording.id == rec.id)
            .execution_options(populate_existing=True)
        )
    ).one()


async def test_rename_automatic_renames_device_and_file_names_only(engine, verify_session) -> None:
    user = await make_user(verify_session)
    device = await _named_recording(verify_session, user)
    from_file = await _named_recording(
        verify_session, user, place_origin="file", place_accuracy_m=None, place_lat=LAT + 3
    )
    picked = await _named_recording(
        verify_session, user, place_origin="picked", place_accuracy_m=None
    )
    unnamed = await _named_recording(verify_session, user, place_name=None)
    gone = await _named_recording(verify_session, user)
    gone.deleted_at = gone.created_at
    nowhere = await add_recording(verify_session, user, "ready")
    before = device.server_seq
    updated_at = device.updated_at
    await verify_session.commit()
    maps = FakeMaps({f"{LAT}": "12 Main St, Galax, VA", f"{LAT + 3}": "9 Elm St, Galax, VA"})

    counts = await _run(engine, maps)

    assert (counts.renamed, counts.unchanged, counts.skipped, counts.failed) == (2, 0, 0, 0)
    assert sorted(maps.calls) == [(LAT, LON, 10), (LAT + 3, LON, None)]
    assert (await _fresh(verify_session, from_file)).place_name == "9 Elm St, Galax, VA"
    device = await _fresh(verify_session, device)
    assert device.place_name == "12 Main St, Galax, VA"
    assert device.server_seq > before
    assert device.updated_at == updated_at
    for other, name in ((picked, "Galax, VA"), (unnamed, None), (gone, "Galax, VA")):
        assert (await _fresh(verify_session, other)).place_name == name
    assert (await _fresh(verify_session, nowhere)).place_name is None


async def test_rename_automatic_counts_an_unchanged_name(engine, verify_session) -> None:
    user = await make_user(verify_session)
    await _named_recording(verify_session, user)
    await verify_session.commit()

    counts = await _run(engine, FakeMaps({f"{LAT}": "Galax, VA"}))

    assert (counts.renamed, counts.unchanged) == (0, 1)


async def test_rename_automatic_skips_a_row_changed_during_lookup(engine, verify_session) -> None:
    user = await make_user(verify_session)
    moved = await _named_recording(verify_session, user)
    renamed = await _named_recording(verify_session, user, place_lat=LAT + 1)
    await verify_session.commit()

    async def change() -> None:
        async with make_sessionmaker(engine)() as other, other.begin():
            for rec_id, field, value in (
                (moved.id, "place_lat", LAT + 0.5),
                (renamed.id, "place_name", "The Rex"),
            ):
                row = await other.get(Recording, rec_id)
                setattr(row, field, value)

    maps = FakeMaps({f"{LAT}": "New", f"{LAT + 1}": "New"}, hook=change)
    counts = await _run(engine, maps)

    assert (counts.renamed, counts.skipped) == (0, 2)
    assert (await _fresh(verify_session, moved)).place_name == "Galax, VA"
    assert (await _fresh(verify_session, renamed)).place_name == "The Rex"


async def test_rename_automatic_skips_a_row_repicked_during_lookup(engine, verify_session) -> None:
    user = await make_user(verify_session)
    rec = await _named_recording(verify_session, user)
    await verify_session.commit()

    async def repick() -> None:
        async with make_sessionmaker(engine)() as other, other.begin():
            (await other.get(Recording, rec.id)).place_origin = "picked"

    counts = await _run(engine, FakeMaps({f"{LAT}": "New"}, hook=repick))

    assert (counts.renamed, counts.skipped) == (0, 1)
    assert (await _fresh(verify_session, rec)).place_name == "Galax, VA"


async def test_rename_automatic_dry_run_writes_nothing(engine, verify_session) -> None:
    user = await make_user(verify_session)
    rec = await _named_recording(verify_session, user)
    before = rec.server_seq
    await verify_session.commit()

    counts = await _run(engine, FakeMaps({f"{LAT}": "12 Main St, Galax, VA"}), dry_run=True)

    assert counts.renamed == 1
    rec = await _fresh(verify_session, rec)
    assert (rec.place_name, rec.server_seq) == ("Galax, VA", before)


async def test_rename_automatic_paces_requests(engine, verify_session) -> None:
    user = await make_user(verify_session)
    for offset in range(3):
        await _named_recording(verify_session, user, place_lat=LAT + offset)
    await verify_session.commit()
    maps = FakeMaps({f"{LAT + offset}": "Galax, VA" for offset in range(3)})
    sleeps: list[float] = []

    await _run(engine, maps, sleeps, per_second=4)

    assert sleeps == [0.25, 0.25, 0.25]


async def test_rename_automatic_backs_off_and_continues_through_an_outage(
    engine, verify_session
) -> None:
    user = await make_user(verify_session)
    busy = await _named_recording(verify_session, user, place_lat=LAT)
    down = await _named_recording(verify_session, user, place_lat=LAT + 1)
    fine = await _named_recording(verify_session, user, place_lat=LAT + 2)
    await verify_session.commit()
    maps = FakeMaps(
        {
            f"{LAT}": MapsBusyError(30),
            f"{LAT + 1}": MapsError("down", transient=True),
            f"{LAT + 2}": "Fine, VA",
        }
    )
    sleeps: list[float] = []

    counts = await _run(engine, maps, sleeps, per_second=1000)

    assert (counts.renamed, counts.failed) == (1, 2)
    assert 30 in sleeps
    assert (await _fresh(verify_session, fine)).place_name == "Fine, VA"
    assert (await _fresh(verify_session, busy)).place_name == "Galax, VA"
    assert (await _fresh(verify_session, down)).place_name == "Galax, VA"


def test_main_prints_the_environment_line_first(monkeypatch, capsys, settings) -> None:
    monkeypatch.setattr(ops_places, "load_settings", lambda: settings)

    assert ops_places.main(["rename-automatic", "--dry-run"]) == 1

    out = capsys.readouterr()
    assert out.out.startswith("environment ")
    assert "Apple Maps" in out.err
