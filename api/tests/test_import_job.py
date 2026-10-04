"""The import job: fetching a Slippery-Hill recording's audio into the bucket."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import TYPE_CHECKING

import httpx2
import pytest
from sqlalchemy import func, select

from crosstune.db.engine import make_sessionmaker
from crosstune.db.locks import advisory_lock_key
from crosstune.jobs import importer as importer_module
from crosstune.jobs.runner import MAX_ATTEMPTS, JobRunner
from crosstune.links.slippery_hill import UPLOAD_FIELD
from crosstune.models import Job, Recording, User
from crosstune.models.user import new_uuid7, utc_now
from crosstune.storage.store import upload_key
from crosstune.vocabulary import JobKind
from tests.fakes import FakeObjectStore
from tests.test_jobs import add_recording, make_user

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncSession

    from crosstune.config import Settings
    from tests.conftest import MockHttp

pytestmark = pytest.mark.anyio

PAGE = "https://www.slippery-hill.com/content/bear-creek-sally-goodin"
FILE = "https://www.slippery-hill.com/system/files/recordings/bearcreeksallygoodin_bobholt.mp3"
PAGE_HTML = (
    Path(__file__).parent / "fixtures" / "slippery_hill" / "bear-creek-sally-goodin.html"
).read_text()
AUDIO = b"ID3" + b"\x00" * 2048


@pytest.fixture
def importer(
    engine, tmp_path, mock_http: MockHttp, settings: Settings
) -> tuple[JobRunner, FakeObjectStore]:
    store = FakeObjectStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings,
    )
    return runner, store


async def seed_import(session: AsyncSession, user: User | None = None) -> Recording:
    user = user or await make_user(session)
    rec = Recording(
        id=new_uuid7(),
        user_id=user.id,
        source="import",
        origin="slippery_hill",
        origin_url=PAGE,
        recorded_at=utc_now(),
        created_at=utc_now(),
        updated_at=utc_now(),
        state="processing",
    )
    session.add(rec)
    await session.flush()
    session.add(Job(recording_id=rec.id, user_id=user.id, kind=JobKind.IMPORT.value))
    await session.commit()
    return rec


async def _job(session: AsyncSession, rec: Recording, kind: JobKind) -> Job | None:
    return await session.scalar(
        select(Job)
        .where(Job.recording_id == rec.id, Job.kind == kind.value)
        .execution_options(populate_existing=True)
    )


async def test_import_fetches_the_file_and_queues_a_transcode(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert store.get_bytes(upload_key(rec.user_id, rec.id)) == AUDIO
    assert rec.state == "uploaded"
    assert rec.playback_bytes == len(AUDIO)
    assert rec.error is None
    assert await _job(verify_session, rec, JobKind.TRANSCODE) is not None
    assert await _job(verify_session, rec, JobKind.IMPORT) is None


async def test_import_fetches_an_upload_field_file_with_a_long_path(
    importer, verify_session, mock_http: MockHttp
) -> None:
    """A path longer than a stored link ref still names the file to fetch."""
    runner, store = importer
    long_path = f"recordings/{'a' * 200}.mp3"
    html = (
        '<html><body><audio src="/system/files/recordings/other.mp3"></audio>'
        f'<div class="{UPLOAD_FIELD}"><audio src="/system/files/{long_path}"></audio></div>'
        "</body></html>"
    )
    mock_http.add(PAGE, httpx2.Response(200, text=html))
    mock_http.add(
        f"https://www.slippery-hill.com/system/files/{long_path}",
        httpx2.Response(200, content=AUDIO),
    )
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert (rec.state, rec.error) == ("uploaded", None)
    assert store.get_bytes(upload_key(rec.user_id, rec.id)) == AUDIO
    assert not any("other.mp3" in str(call.url) for call in mock_http.calls)


async def test_import_reads_a_bare_host_page_from_the_canonical_host(
    importer, verify_session, mock_http: MockHttp
) -> None:
    """A page address that does not canonicalize keeps its path but moves to the www host."""
    runner, store = importer
    mock_http.add("https://www.slippery-hill.com/node/42", httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)
    rec.origin_url = "http://slippery-hill.com/node/42"
    await verify_session.commit()

    await runner.run_once()

    await verify_session.refresh(rec)
    assert (rec.state, rec.error) == ("uploaded", None)
    assert store.get_bytes(upload_key(rec.user_id, rec.id)) == AUDIO


async def test_import_without_audio_fails_at_once(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(200, text="<html><body>No audio</body></html>"))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "Couldn't find the audio on Slippery-Hill"
    assert await _job(verify_session, rec, JobKind.IMPORT) is None
    assert store.keys() == []


async def test_import_over_the_file_cap_fails_and_stores_nothing(
    engine, tmp_path, verify_session, mock_http: MockHttp, settings: Settings
) -> None:
    store = FakeObjectStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings.model_copy(update={"recording_max_file_bytes": 1024}),
    )
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "File too large"
    assert store.keys() == []
    assert await _job(verify_session, rec, JobKind.IMPORT) is None


async def test_import_over_quota_fails(
    engine, tmp_path, verify_session, mock_http: MockHttp, settings: Settings
) -> None:
    store = FakeObjectStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings.model_copy(update={"recording_quota_bytes": 4096}),
    )
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    user = await make_user(verify_session)
    await add_recording(verify_session, user, "ready", playback_bytes=4096 - len(AUDIO) + 1)
    rec = await seed_import(verify_session, user)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "Storage quota exceeded"
    assert store.keys() == []
    assert await _job(verify_session, rec, JobKind.IMPORT) is None


async def test_import_refuses_a_redirect_off_the_host(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(302, headers={"Location": "https://example.com/x.mp3"}))
    mock_http.add("https://example.com/", httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "Couldn't find the audio on Slippery-Hill"
    assert store.keys() == []
    assert not [call for call in mock_http.calls if call.url.host == "example.com"]


async def test_import_follows_a_redirect_on_the_host(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    moved = "https://www.slippery-hill.com/system/files/recordings/moved.mp3"
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(302, headers={"Location": moved}))
    mock_http.add(moved, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "uploaded"
    assert store.get_bytes(upload_key(rec.user_id, rec.id)) == AUDIO


async def test_import_network_failure_retries_then_fails(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(503))
    rec = await seed_import(verify_session)

    for attempt in range(1, MAX_ATTEMPTS + 1):
        job = await _job(verify_session, rec, JobKind.IMPORT)
        assert job is not None
        job.locked_until = None
        await verify_session.commit()
        await runner.run_once()
        await verify_session.refresh(rec)
        if attempt < MAX_ATTEMPTS:
            # A retry still waits on the import, so the row never claims an upload it lacks.
            assert rec.state == "processing"

    assert rec.state == "failed"
    assert rec.error == "Couldn't reach Slippery-Hill"
    assert store.keys() == []
    assert await _job(verify_session, rec, JobKind.IMPORT) is None


async def test_import_of_a_page_that_cannot_be_reached_retries(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(503))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    job = await _job(verify_session, rec, JobKind.IMPORT)
    assert job is not None
    assert job.attempts == 1
    assert rec.state == "processing"
    assert store.keys() == []


async def _chunks(data: bytes, *, then_wait: asyncio.Event | None = None) -> AsyncIterator[bytes]:
    """A response body with no Content-Length, so the cap is enforced while streaming."""
    for start in range(0, len(data), 512):
        yield data[start : start + 512]
    if then_wait is not None:
        await then_wait.wait()


async def test_import_over_the_cap_while_streaming_leaves_no_scratch_file(
    engine, tmp_path, verify_session, mock_http: MockHttp, settings: Settings
) -> None:
    store = FakeObjectStore()
    work_root = tmp_path / "work"
    work_root.mkdir()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=work_root,
        http_client=mock_http.client(),
        settings=settings.model_copy(update={"recording_max_file_bytes": 1024}),
    )
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=_chunks(AUDIO)))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.error == "File too large"
    assert store.keys() == []
    assert list(work_root.iterdir()) == []


@pytest.mark.parametrize("status", [404, 410])
async def test_import_of_a_missing_file_fails_at_once(
    importer, verify_session, mock_http: MockHttp, status: int
) -> None:
    runner, store = importer
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(status))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "Couldn't find the audio on Slippery-Hill"
    assert await _job(verify_session, rec, JobKind.IMPORT) is None
    assert store.keys() == []


async def test_import_refuses_a_redirect_to_another_port(
    importer, verify_session, mock_http: MockHttp
) -> None:
    runner, store = importer
    elsewhere = "https://www.slippery-hill.com:8443/system/files/recordings/x.mp3"
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(302, headers={"Location": elsewhere}))
    mock_http.add(elsewhere, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    assert rec.state == "failed"
    assert rec.error == "Couldn't find the audio on Slippery-Hill"
    assert store.keys() == []
    assert not [call for call in mock_http.calls if call.url.port == 8443]


async def test_import_that_outlasts_the_download_limit_retries(
    importer, verify_session, mock_http: MockHttp, monkeypatch: pytest.MonkeyPatch
) -> None:
    runner, store = importer
    monkeypatch.setattr(importer_module, "DOWNLOAD_TIMEOUT_SECONDS", 0.01)
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=_chunks(AUDIO, then_wait=asyncio.Event())))
    rec = await seed_import(verify_session)

    await runner.run_once()

    await verify_session.refresh(rec)
    job = await _job(verify_session, rec, JobKind.IMPORT)
    assert job is not None
    assert job.attempts == 1
    assert rec.state == "processing"
    assert store.keys() == []


class _GatedStore(FakeObjectStore):
    """A store whose upload waits for the test, so it can look while the upload runs."""

    def __init__(self) -> None:
        super().__init__()
        self.uploading = asyncio.Event()
        self.release = asyncio.Event()

    async def upload(self, path: Path, key: str, content_type: str) -> int:
        self.uploading.set()
        await self.release.wait()
        return await super().upload(path, key, content_type)


async def test_import_does_not_hold_the_user_lock_while_uploading(
    engine, tmp_path, verify_session, mock_http: MockHttp, settings: Settings
) -> None:
    store = _GatedStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings,
    )
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    task = asyncio.create_task(runner.run_once())
    try:
        await store.uploading.wait()
        async with make_sessionmaker(engine)() as other, other.begin():
            # The try-lock answers at once, so a held lock fails the test instead of hanging it.
            acquired = await other.scalar(
                select(func.pg_try_advisory_xact_lock(advisory_lock_key(rec.user_id)))
            )
        assert acquired is True
    finally:
        store.release.set()
        await task

    await verify_session.refresh(rec)
    assert rec.state == "uploaded"


async def test_import_of_a_recording_deleted_during_the_upload_keeps_nothing(
    engine, tmp_path, verify_session, mock_http: MockHttp, settings: Settings
) -> None:
    store = _GatedStore()
    runner = JobRunner(
        make_sessionmaker(engine),
        store,
        work_root=tmp_path,
        http_client=mock_http.client(),
        settings=settings,
    )
    mock_http.add(PAGE, httpx2.Response(200, text=PAGE_HTML))
    mock_http.add(FILE, httpx2.Response(200, content=AUDIO))
    rec = await seed_import(verify_session)

    async def run_the_job_alone() -> None:
        # Claimed and run directly, so the purge sweep in run_once can't be what removes it.
        job = await runner._claim()
        assert job is not None
        await runner._run_job(job)

    task = asyncio.create_task(run_the_job_alone())
    try:
        await store.uploading.wait()
        rec.deleted_at = utc_now()
        await verify_session.commit()
    finally:
        store.release.set()
        await task

    assert store.keys() == []
    assert await _job(verify_session, rec, JobKind.IMPORT) is None
