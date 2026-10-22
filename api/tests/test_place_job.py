"""The place job: naming a recording's coordinates through Apple Maps."""

from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import anyio
import httpx2
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from sqlalchemy import select

from crosstune.db.base import new_uuid7, utc_now
from crosstune.db.engine import make_sessionmaker
from crosstune.jobs.attempt import MAX_ATTEMPTS, RETRY_BACKOFF_SECONDS
from crosstune.jobs.handlers.place import NAMING_BACKOFF_CAP, NAMING_GIVE_UP_AFTER
from crosstune.jobs.runner import JobRunner
from crosstune.models import Job, Place, Recording
from crosstune.places.maps import MAPS_URL, AppleMaps
from crosstune.vocabulary import JobKind
from tests.conftest import MockHttp
from tests.fakes import FakeObjectStore
from tests.helpers import T1, push, recording, uid
from tests.test_jobs import add_recording, make_user

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings

pytestmark = pytest.mark.anyio

TOKEN_URL = f"{MAPS_URL}/v1/token"
REVERSE_URL = f"{MAPS_URL}/v1/reverseGeocode"
GALAX = {
    "name": "Galax",
    "countryCode": "US",
    "structuredAddress": {"locality": "Galax", "administrativeAreaCode": "VA"},
}
LAT, LON = 36.661234567, -80.923912345
UPDATED_AT = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


def _pem() -> str:
    return (
        ec.generate_private_key(ec.SECP256R1())
        .private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode()
    )


@pytest.fixture
def maps() -> AppleMaps:
    return AppleMaps(team_id="TEAM123456", key_id="KEY1234567", private_key=_pem())


@pytest.fixture
def http() -> MockHttp:
    http = MockHttp()
    http.add(
        TOKEN_URL,
        httpx2.Response(200, json={"accessToken": "maps-access", "expiresInSeconds": 1800}),
    )
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": [GALAX]}))
    return http


@pytest.fixture
def namer(engine, tmp_path, http: MockHttp, maps: AppleMaps, settings: Settings) -> JobRunner:
    return JobRunner(
        make_sessionmaker(engine),
        FakeObjectStore(),
        orphan_sweep_seconds=None,
        work_root=tmp_path,
        http_client=http.client(),
        maps=maps,
        settings=settings,
    )


async def seed_place(
    session: AsyncSession, *, origin: str = "picked", accuracy: int | None = None
) -> tuple[Recording, Job]:
    user = await make_user(session)
    rec = await add_recording(
        session,
        user,
        "ready",
        place_lat=LAT,
        place_lon=LON,
        place_origin=origin,
        place_accuracy_m=accuracy,
    )
    rec.updated_at = UPDATED_AT
    job = Job(recording_id=rec.id, user_id=user.id, kind=JobKind.PLACE.value)
    session.add(job)
    await session.commit()
    return rec, job


async def _place_jobs(session: AsyncSession, recording_id: uuid.UUID) -> list[Job]:
    return list(
        await session.scalars(
            select(Job)
            .where(Job.recording_id == recording_id, Job.kind == JobKind.PLACE.value)
            .execution_options(populate_existing=True)
        )
    )


async def test_names_unnamed_coordinates(namer: JobRunner, verify_session, http) -> None:
    rec, _ = await seed_place(verify_session)
    before_seq = rec.server_seq

    assert await namer.run_once() == 1

    await verify_session.refresh(rec)
    assert rec.place_name == "Galax, VA"
    assert (rec.place_lat, rec.place_lon) == (LAT, LON)
    assert rec.server_seq > before_seq
    assert rec.updated_at == UPDATED_AT
    assert await _place_jobs(verify_session, rec.id) == []
    [lookup] = [call for call in http.calls if str(call.url).startswith(REVERSE_URL)]
    assert lookup.url.params["loc"] == f"{LAT},{LON}"


async def test_clips_a_long_name(namer: JobRunner, verify_session, http) -> None:
    long_place = {"name": "x" * 300, "structuredAddress": {}}
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": [long_place]}))
    rec, _ = await seed_place(verify_session)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name == "x" * 200


async def test_a_place_maps_cannot_name_stays_unnamed(
    namer: JobRunner, verify_session, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": []}))
    rec, _ = await seed_place(verify_session)
    before_seq = rec.server_seq

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    assert rec.server_seq == before_seq
    assert await _place_jobs(verify_session, rec.id) == []


async def test_leaves_a_place_changed_while_naming(
    namer: JobRunner, verify_session, engine, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec, job = await seed_place(verify_session)
    real_reverse_name = maps.reverse_name

    async def move_then_name(*args, **kwargs) -> str | None:
        async with make_sessionmaker(engine)() as other:
            moved = await other.get(Recording, rec.id)
            moved.place_lat, moved.place_lon = 52.8436, -8.9864
            moved.place_origin = "picked"
            await other.commit()
        return await real_reverse_name(*args, **kwargs)

    monkeypatch.setattr(maps, "reverse_name", move_then_name)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert (rec.place_lat, rec.place_lon, rec.place_name) == (52.8436, -8.9864, None)
    assert await verify_session.get(Job, job.id, populate_existing=True) is None
    # The new coordinates still need a name, so they get a job of their own.
    [requeued] = await _place_jobs(verify_session, rec.id)
    assert requeued.id != job.id


async def test_leaves_a_name_set_while_naming(
    namer: JobRunner, verify_session, engine, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    rec, _ = await seed_place(verify_session)
    real_reverse_name = maps.reverse_name

    async def name_then_lookup(*args, **kwargs) -> str | None:
        async with make_sessionmaker(engine)() as other:
            named = await other.get(Recording, rec.id)
            named.place_name = "Joe's kitchen"
            await other.commit()
        return await real_reverse_name(*args, **kwargs)

    monkeypatch.setattr(maps, "reverse_name", name_then_lookup)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name == "Joe's kitchen"
    assert await _place_jobs(verify_session, rec.id) == []


def _runner(engine, tmp_path, settings: Settings, **clients) -> JobRunner:
    return JobRunner(
        make_sessionmaker(engine),
        FakeObjectStore(),
        orphan_sweep_seconds=None,
        work_root=tmp_path,
        settings=settings,
        **clients,
    )


async def test_waits_for_maps_to_be_configured(
    engine, tmp_path, verify_session, http: MockHttp, settings: Settings
) -> None:
    runner = _runner(engine, tmp_path, settings, http_client=http.client(), maps=None)
    rec, job = await seed_place(verify_session)
    before_seq = rec.server_seq

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    assert rec.server_seq == before_seq
    [held] = await _place_jobs(verify_session, rec.id)
    assert held.id == job.id
    assert held.attempts == 0
    assert held.locked_until is not None
    assert held.locked_until > utc_now()
    assert http.calls == []


async def test_waits_for_an_http_client(
    engine, tmp_path, verify_session, maps: AppleMaps, settings: Settings
) -> None:
    runner = _runner(engine, tmp_path, settings, maps=maps)
    rec, job = await seed_place(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    [held] = await _place_jobs(verify_session, rec.id)
    assert held.id == job.id
    assert held.locked_until is not None
    assert held.locked_until > utc_now()


async def test_unconfigured_maps_gives_up_after_a_week(
    engine, tmp_path, verify_session, http: MockHttp, settings: Settings
) -> None:
    runner = _runner(engine, tmp_path, settings, http_client=http.client(), maps=None)
    rec, job = await seed_place(verify_session)
    job.created_at = utc_now() - NAMING_GIVE_UP_AFTER - timedelta(minutes=1)
    await verify_session.commit()

    await runner.run_once()

    assert await _place_jobs(verify_session, rec.id) == []


async def test_busy_maps_retries(namer: JobRunner, verify_session, http) -> None:
    http.add(REVERSE_URL, httpx2.Response(429, headers={"Retry-After": "600"}))
    rec, job = await seed_place(verify_session)
    before_seq = rec.server_seq

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    assert rec.server_seq == before_seq
    [held] = await _place_jobs(verify_session, rec.id)
    assert held.id == job.id
    assert held.attempts == 0
    assert held.last_error is not None
    # Held back at least as long as Apple Maps asked, past the usual backoff.
    assert held.locked_until is not None
    assert held.locked_until >= utc_now() + timedelta(seconds=590)


async def test_a_failing_lookup_keeps_retrying_past_the_attempt_limit(
    namer: JobRunner, verify_session, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(500))
    rec, job = await seed_place(verify_session)
    job.attempts = MAX_ATTEMPTS - 1
    await verify_session.commit()

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    [held] = await _place_jobs(verify_session, rec.id)
    assert held.id == job.id
    assert held.attempts == MAX_ATTEMPTS - 1
    assert held.last_error == "Apple Maps answered 500"
    assert held.locked_until is not None
    assert held.locked_until > utc_now()


@pytest.mark.parametrize(
    ("age", "expected"),
    [
        (timedelta(0), timedelta(seconds=RETRY_BACKOFF_SECONDS)),
        (timedelta(minutes=10), timedelta(minutes=10)),
        (timedelta(days=2), NAMING_BACKOFF_CAP),
    ],
)
async def test_a_failing_lookup_backs_off_as_long_as_it_has_waited(
    namer: JobRunner, verify_session, http, age: timedelta, expected: timedelta
) -> None:
    http.add(REVERSE_URL, httpx2.Response(503))
    rec, job = await seed_place(verify_session)
    job.created_at = utc_now() - age
    await verify_session.commit()

    before = utc_now()
    await namer.run_once()

    [held] = await _place_jobs(verify_session, rec.id)
    assert held.locked_until is not None
    assert before + expected - timedelta(seconds=5) <= held.locked_until
    assert held.locked_until <= utc_now() + expected + timedelta(seconds=5)


async def test_a_failing_lookup_gives_up_after_a_week(
    namer: JobRunner, verify_session, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(500))
    rec, job = await seed_place(verify_session)
    job.created_at = utc_now() - NAMING_GIVE_UP_AFTER - timedelta(minutes=1)
    await verify_session.commit()

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_name is None
    assert await _place_jobs(verify_session, rec.id) == []


async def test_skips_a_deleted_recording(namer: JobRunner, verify_session, http) -> None:
    rec, _ = await seed_place(verify_session)
    rec.deleted_at = utc_now()
    await verify_session.commit()

    await namer.run_once()

    assert await _place_jobs(verify_session, rec.id) == []
    assert http.calls == []


async def test_stale_push_after_naming_is_named_again(
    client, auth_headers, verify_session, namer: JobRunner
) -> None:
    rec = uid()
    place = {"place_lat": LAT, "place_lon": LON}
    await push(client, auth_headers("user_a"), recording(rec, **place))
    await namer.run_once()
    row = await verify_session.get(Recording, uuid.UUID(rec))
    assert row is not None
    assert row.place_name == "Galax, VA"

    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, place_name=None, **place)
    )

    assert result["status"] == "applied"
    assert len(await _place_jobs(verify_session, uuid.UUID(rec))) == 1


async def test_giving_up_on_maps_is_a_warning(
    namer: JobRunner, verify_session, http, caplog: pytest.LogCaptureFixture
) -> None:
    http.add(REVERSE_URL, httpx2.Response(500))
    _, job = await seed_place(verify_session)
    job.created_at = utc_now() - NAMING_GIVE_UP_AFTER - timedelta(minutes=1)
    await verify_session.commit()

    with caplog.at_level(logging.WARNING, logger="crosstune.jobs.handlers.place"):
        await namer.run_once()

    [gave_up] = [r for r in caplog.records if r.getMessage() == "place gave up"]
    assert gave_up.levelno == logging.WARNING
    assert gave_up.exc_info is None


async def test_an_edit_to_unnamed_coordinates_spends_no_lookup(
    client, auth_headers, verify_session, namer: JobRunner, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": []}))
    rec = uid()
    place = {"place_lat": LAT, "place_lon": LON}
    await push(client, auth_headers("user_a"), recording(rec, **place))
    await namer.run_once()
    assert await _place_jobs(verify_session, uuid.UUID(rec)) == []

    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, notes="Joe's kitchen", **place)
    )
    [replay] = await push(
        client, auth_headers("user_a"), recording(rec, T1, notes="Joe's kitchen", **place)
    )

    assert (result["status"], replay["status"]) == ("applied", "applied")
    assert await _place_jobs(verify_session, uuid.UUID(rec)) == []


async def test_moving_unnamed_coordinates_queues_a_lookup(
    client, auth_headers, verify_session, namer: JobRunner, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, json={"results": []}))
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, place_lat=LAT, place_lon=LON))
    await namer.run_once()

    await push(client, auth_headers("user_a"), recording(rec, T1, place_lat=1.5, place_lon=2.5))

    assert len(await _place_jobs(verify_session, uuid.UUID(rec))) == 1


async def test_a_timed_out_lookup_spends_no_attempt(
    namer: JobRunner, verify_session, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def time_out(*_args, **_kwargs) -> str | None:
        raise TimeoutError

    monkeypatch.setattr(maps, "reverse_name", time_out)
    rec, job = await seed_place(verify_session)
    job.attempts = MAX_ATTEMPTS - 1
    await verify_session.commit()

    await namer.run_once()

    [held] = await _place_jobs(verify_session, rec.id)
    assert held.attempts == MAX_ATTEMPTS - 1
    assert held.locked_until is not None
    assert held.locked_until > utc_now()


async def test_a_code_error_still_gives_up_after_its_last_attempt(
    namer: JobRunner, verify_session, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def broken(*_args, **_kwargs) -> str | None:
        msg = "bug"
        raise RuntimeError(msg)

    monkeypatch.setattr(maps, "reverse_name", broken)
    rec, job = await seed_place(verify_session)
    job.attempts = MAX_ATTEMPTS - 1
    await verify_session.commit()

    await namer.run_once()

    assert await _place_jobs(verify_session, rec.id) == []


@pytest.mark.parametrize("status", [400, 403, 404])
async def test_a_permanent_maps_failure_spends_an_attempt(
    namer: JobRunner, verify_session, http, status: int
) -> None:
    http.add(REVERSE_URL, httpx2.Response(status))
    rec, job = await seed_place(verify_session)

    await namer.run_once()

    [held] = await _place_jobs(verify_session, rec.id)
    assert held.id == job.id
    assert held.attempts == 1
    assert held.locked_until is not None


async def test_a_permanent_maps_failure_gives_up_after_its_last_attempt(
    namer: JobRunner, verify_session, http
) -> None:
    http.add(REVERSE_URL, httpx2.Response(200, text="<html>"))
    rec, job = await seed_place(verify_session)
    job.attempts = MAX_ATTEMPTS - 1
    await verify_session.commit()

    await namer.run_once()

    assert await _place_jobs(verify_session, rec.id) == []


async def _hold(session: AsyncSession, job: Job, *, error: str | None) -> datetime:
    """Hold the job back: a wait after a failure carries its error; a live claim has none."""
    until = utc_now() + timedelta(hours=5)
    job.locked_until = until
    job.last_error = error
    job.created_at = utc_now() - timedelta(days=6)
    await session.commit()
    return until


async def test_new_coordinates_restart_a_waiting_jobs_clock(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, place_lat=LAT, place_lon=LON))
    [job] = await _place_jobs(verify_session, uuid.UUID(rec))
    await _hold(verify_session, job, error="Apple Maps answered 503")
    before = utc_now()

    await push(client, auth_headers("user_a"), recording(rec, T1, place_lat=1.5, place_lon=2.5))

    [waiting] = await _place_jobs(verify_session, uuid.UUID(rec))
    assert waiting.id == job.id
    assert waiting.created_at >= before
    assert waiting.locked_until is None


async def test_new_coordinates_leave_a_live_claim_alone(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, place_lat=LAT, place_lon=LON))
    [job] = await _place_jobs(verify_session, uuid.UUID(rec))
    claimed_until = await _hold(verify_session, job, error=None)
    before = utc_now()

    await push(client, auth_headers("user_a"), recording(rec, T1, place_lat=1.5, place_lon=2.5))

    [claimed] = await _place_jobs(verify_session, uuid.UUID(rec))
    assert claimed.locked_until == claimed_until
    assert claimed.created_at >= before


async def test_a_claim_clears_the_last_error(
    namer: JobRunner, verify_session, engine, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, job = await seed_place(verify_session)
    job.last_error = "Apple Maps answered 503"
    await verify_session.commit()
    seen: list[str | None] = []
    real_reverse_name = maps.reverse_name

    async def look(*args, **kwargs) -> str | None:
        async with make_sessionmaker(engine)() as other:
            seen.append((await other.get(Job, job.id)).last_error)
        return await real_reverse_name(*args, **kwargs)

    monkeypatch.setattr(maps, "reverse_name", look)

    await namer.run_once()

    assert seen == [None]


async def test_a_runner_with_maps_releases_waiting_jobs_on_start(
    namer: JobRunner, verify_session
) -> None:
    waiting_rec, waiting = await seed_place(verify_session)
    await _hold(verify_session, waiting, error="Apple Maps is not configured")
    claimed_rec, claimed = await seed_place(verify_session)
    claimed_until = await _hold(verify_session, claimed, error=None)

    await namer.release_waiting_place_jobs()

    [released] = await _place_jobs(verify_session, waiting_rec.id)
    assert released.locked_until is None
    [kept] = await _place_jobs(verify_session, claimed_rec.id)
    assert kept.locked_until == claimed_until


async def test_a_starting_runner_names_a_job_held_while_maps_was_unconfigured(
    namer: JobRunner, verify_session
) -> None:
    rec, job = await seed_place(verify_session)
    await _hold(verify_session, job, error="Apple Maps is not configured")

    namer.start()
    try:
        with anyio.fail_after(10):
            while await _place_jobs(verify_session, rec.id):  # noqa: ASYNC110 -- polls the database
                await anyio.sleep(0.05)
    finally:
        await namer.stop()

    await verify_session.refresh(rec)
    assert rec.place_name == "Galax, VA"


async def test_a_runner_without_maps_keeps_waiting_jobs_held(
    engine, tmp_path, verify_session, http: MockHttp, settings: Settings
) -> None:
    runner = _runner(engine, tmp_path, settings, http_client=http.client(), maps=None)
    rec, job = await seed_place(verify_session)
    until = await _hold(verify_session, job, error="Apple Maps is not configured")

    await runner.release_waiting_place_jobs()

    [held] = await _place_jobs(verify_session, rec.id)
    assert held.locked_until == until


async def _saved_place(session: AsyncSession, rec: Recording) -> Place:
    place = Place(
        id=new_uuid7(),
        user_id=rec.user_id,
        name="Joe's kitchen",
        lat=LAT,
        lon=LON,
        created_at=utc_now(),
        updated_at=utc_now(),
    )
    session.add(place)
    await session.commit()
    return place


async def test_job_links_a_matching_take_and_still_names_it(
    namer: JobRunner, verify_session
) -> None:
    rec, _ = await seed_place(verify_session, origin="device", accuracy=10)
    place = await _saved_place(verify_session, rec)
    before_seq = rec.server_seq

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_id == place.id
    assert rec.place_name == "Galax, VA"
    assert rec.place_origin == "device"
    assert rec.server_seq > before_seq
    assert rec.updated_at == UPDATED_AT


async def test_job_links_a_file_take_without_accuracy(namer: JobRunner, verify_session) -> None:
    rec, _ = await seed_place(verify_session, origin="file")
    place = await _saved_place(verify_session, rec)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_id == place.id


async def test_job_leaves_a_picked_take_unlinked(namer: JobRunner, verify_session) -> None:
    rec, _ = await seed_place(verify_session, origin="picked")
    await _saved_place(verify_session, rec)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_id is None
    assert rec.place_name == "Galax, VA"


async def test_job_leaves_a_loose_take_unlinked(namer: JobRunner, verify_session) -> None:
    rec, _ = await seed_place(verify_session, origin="device", accuracy=200)
    await _saved_place(verify_session, rec)

    await namer.run_once()

    await verify_session.refresh(rec)
    assert rec.place_id is None


async def test_job_names_with_the_takes_accuracy(
    namer: JobRunner, verify_session, maps: AppleMaps, monkeypatch: pytest.MonkeyPatch
) -> None:
    await seed_place(verify_session, origin="device", accuracy=120)
    seen: list[int | None] = []
    real_reverse_name = maps.reverse_name

    async def look(*args, **kwargs) -> str | None:
        seen.append(kwargs["accuracy_m"])
        return await real_reverse_name(*args, **kwargs)

    monkeypatch.setattr(maps, "reverse_name", look)

    await namer.run_once()

    assert seen == [120]
