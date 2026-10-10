"""Seeding the marketing account from the marketing capture fixture."""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Self

import httpx2
import pytest
from sqlalchemy import func, select

from crosstune.config import Settings
from crosstune.models import DeletedAccount, Entitlement, Job, Recording, Scan, User, UserSettings
from crosstune.ops import seed_marketing
from crosstune.ops.seed_marketing import (
    MARKETING_EMAIL,
    SeedRefusedError,
    check_target,
    seed,
    settings_id,
)
from crosstune.storage.store import scan_key, upload_key
from crosstune.sync.tables import TABLE_ORDER, TABLES
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError
from crosstune.vocabulary import JobKind, RecordingState
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

FIXTURE = Path(__file__).resolve().parents[2] / "apple" / "Marketing" / "catalog.json"
CLERK_ID = "user_marketing_test"
CLERK_USERS_URL = "https://api.clerk.com/v1/users"
DEV_KEY = "sk_test_x"  # gitleaks:allow -- fixture


def _fixture() -> dict:
    return json.loads(FIXTURE.read_text())


async def _counts(session: AsyncSession, user_id: uuid.UUID) -> dict[str, int]:
    counts = {}
    for table in TABLE_ORDER:
        spec = TABLES[table]
        counts[table] = await session.scalar(
            select(func.count()).select_from(spec.model).where(spec.owned_by(user_id))
        )
    return counts


def _pushed_counts() -> dict[str, int]:
    fixture = _fixture()
    return {table: len(fixture.get(table, [])) for table in TABLE_ORDER}


def _expected_counts() -> dict[str, int]:
    # The server writes every account's one entitlements row; the fixture never holds it.
    return {**_pushed_counts(), "entitlements": 1}


async def _user(session: AsyncSession) -> User:
    return (await session.execute(select(User).where(User.clerk_user_id == CLERK_ID))).scalar_one()


async def test_seed_creates_every_row(session: AsyncSession, settings: Settings) -> None:
    result = await seed(session, FakeObjectStore(), FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)

    user = await _user(session)
    assert user.email == MARKETING_EMAIL
    assert await _counts(session, user.id) == _expected_counts()
    entitlement = (
        await session.execute(select(Entitlement).where(Entitlement.user_id == user.id))
    ).scalar_one()
    assert (entitlement.premium_source, entitlement.premium_expires_at) == ("comp", None)
    assert result.applied == {t: n for t, n in _pushed_counts().items() if n}


async def test_seed_twice_is_idempotent(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    await seed(session, store, FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)
    first_user = await _user(session)
    first_keys = store.keys()

    second = await seed(session, store, FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)

    user = await _user(session)
    assert user.id == first_user.id
    assert await _counts(session, user.id) == _expected_counts()
    assert store.keys() == first_keys
    # Files already confirmed are not uploaded or transcoded again.
    assert second.enqueued == []
    jobs = await session.scalar(select(func.count()).select_from(Job))
    assert jobs == len(_fixture()["recordings"])


async def test_seed_uploads_files(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    result = await seed(session, store, FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)
    user = await _user(session)
    fixture = _fixture()
    assets = FIXTURE.parent

    for row in fixture["recordings"]:
        rid = uuid.UUID(row["id"])
        source = assets / fixture["files"][row["id"]]
        assert store.get_bytes(upload_key(user.id, rid)) == source.read_bytes()
        recording = await session.get(Recording, rid)
        assert recording.state == "uploaded"
        assert recording.playback_bytes == source.stat().st_size
        assert recording.playback_key is None
        job = await session.scalar(select(Job).where(Job.recording_id == rid))
        assert job.kind == JobKind.TRANSCODE.value
    assert sorted(result.enqueued) == sorted(uuid.UUID(r["id"]) for r in fixture["recordings"])

    for row in fixture["scans"]:
        sid = uuid.UUID(row["id"])
        key = scan_key(user.id, sid)
        assert store.get_bytes(key) == (assets / fixture["files"][row["id"]]).read_bytes()
        scan = await session.get(Scan, sid)
        assert (scan.state, scan.file_key, scan.file_bytes) == (
            "ready",
            key,
            len(store.get_bytes(key)),
        )


async def test_seed_rekeys_settings_to_the_clerk_user(
    session: AsyncSession, settings: Settings
) -> None:
    await seed(session, FakeObjectStore(), FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)
    user = await _user(session)

    stored = (
        await session.execute(select(UserSettings).where(UserSettings.user_id == user.id))
    ).scalar_one()
    assert stored.id == settings_id(CLERK_ID)
    assert stored.id != uuid.UUID(_fixture()["user_settings"][0]["id"])


def test_settings_id_matches_the_clients() -> None:
    # The value web's settingsId('user_123') and Swift's settingsID(clerkUserID:) derive.
    assert settings_id("user_123") == uuid.uuid5(
        uuid.UUID("5d1c0b8a-3e7f-4a92-9c64-2b8e1f0a7d33"), "user_123"
    )


async def test_seed_never_purges(session: AsyncSession, settings: Settings) -> None:
    store = FakeObjectStore()
    await seed(session, store, FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)
    first_user = await _user(session)

    await seed(session, store, FIXTURE, CLERK_ID, MARKETING_EMAIL, settings)

    assert await session.scalar(select(func.count()).select_from(DeletedAccount)) == 0
    assert (await _user(session)).id == first_user.id
    assert await _counts(session, first_user.id) == _expected_counts()


async def test_seed_refuses_a_row_without_its_file(
    session: AsyncSession, tmp_path: Path, settings: Settings
) -> None:
    fixture = _fixture()
    recording_id = fixture["recordings"][0]["id"]
    del fixture["files"][recording_id]
    for name in set(_fixture()["files"].values()):
        (tmp_path / name).parent.mkdir(parents=True, exist_ok=True)
        (tmp_path / name).write_bytes((FIXTURE.parent / name).read_bytes())
    broken = tmp_path / "catalog.json"
    broken.write_text(json.dumps(fixture))

    with pytest.raises(SeedRefusedError, match=f"recordings {recording_id}"):
        await seed(session, FakeObjectStore(), broken, CLERK_ID, MARKETING_EMAIL, settings)


def test_check_target_refuses_the_e2e_database() -> None:
    settings = Settings(
        database_url="postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune_e2e",
    )
    with pytest.raises(SeedRefusedError, match="e2e"):
        check_target(settings)


def test_check_target_refuses_a_hosted_environment() -> None:
    with pytest.raises(SeedRefusedError, match="production"):
        check_target(
            Settings(
                environment="production",
                clerk_issuer="https://x",
                clerk_secret_key="sk",
                clerk_authorized_parties=["https://x"],
            )
        )


def test_check_target_refuses_a_live_clerk_key() -> None:
    with pytest.raises(SeedRefusedError, match="development instance"):
        check_target(Settings(clerk_secret_key="sk_live_x"))  # gitleaks:allow -- fixture


def test_check_target_accepts_the_development_database() -> None:
    check_target(Settings(clerk_secret_key=DEV_KEY))


def test_check_target_needs_the_clerk_secret() -> None:
    with pytest.raises(SeedRefusedError, match="CROSSTUNE_CLERK_SECRET_KEY"):
        check_target(Settings(clerk_secret_key=""))


def _clerk_user(user_id: str, email: str) -> dict[str, Any]:
    """The part of a Clerk Backend API user object the seed reads."""
    return {"id": user_id, "email_addresses": [{"email_address": email}]}


async def _find_or_create_against(payload: Any, email: str = MARKETING_EMAIL) -> str:
    """Run find_or_create_user against a Clerk that answers every GET with `payload`."""
    client = httpx2.AsyncClient(
        transport=httpx2.MockTransport(lambda _request: httpx2.Response(200, json=payload))
    )
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        return await users.find_or_create_user(email)
    finally:
        await client.aclose()


class _ClerkStub:
    """Answers the Backend API's user list and create routes from a dict of known users."""

    def __init__(self, users: dict[str, str] | None = None, status: int = 200) -> None:
        self.users = dict(users or {})
        self.status = status
        self.calls: list[httpx2.Request] = []

    def handler(self, request: httpx2.Request) -> httpx2.Response:
        self.calls.append(request)
        if self.status != 200:
            return httpx2.Response(self.status)
        if request.method == "GET":
            email = request.url.params["email_address"]
            found = [_clerk_user(self.users[email], email)] if email in self.users else []
            return httpx2.Response(200, json=found)
        body = json.loads(request.content)
        new_id = f"user_{len(self.users) + 1}"
        self.users[body["email_address"][0]] = new_id
        return httpx2.Response(200, json=_clerk_user(new_id, body["email_address"][0]))

    async def find_or_create(self, email: str) -> str:
        client = httpx2.AsyncClient(transport=httpx2.MockTransport(self.handler))
        try:
            users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
            return await users.find_or_create_user(email)
        finally:
            await client.aclose()


async def test_clerk_finds_an_existing_user_by_email() -> None:
    clerk = _ClerkStub({MARKETING_EMAIL: "user_known"})

    assert await clerk.find_or_create(MARKETING_EMAIL) == "user_known"
    assert [c.method for c in clerk.calls] == ["GET"]
    assert clerk.calls[0].url.params["email_address"] == MARKETING_EMAIL
    assert clerk.calls[0].headers["authorization"] == "Bearer sk_test_secret"


async def test_clerk_creates_a_missing_user_without_a_password() -> None:
    clerk = _ClerkStub()

    created = await clerk.find_or_create(MARKETING_EMAIL)

    assert created == clerk.users[MARKETING_EMAIL]
    assert [c.method for c in clerk.calls] == ["GET", "POST"]
    assert json.loads(clerk.calls[1].content) == {
        "email_address": [MARKETING_EMAIL],
        "skip_password_requirement": True,
    }
    assert str(clerk.calls[1].url) == CLERK_USERS_URL


async def test_clerk_error_raises_clerk_unavailable() -> None:
    with pytest.raises(ClerkUnavailableError):
        await _ClerkStub(status=500).find_or_create(MARKETING_EMAIL)


async def test_clerk_rejects_a_user_list_that_is_not_a_list() -> None:
    with pytest.raises(ClerkUnavailableError, match="unexpected"):
        await _find_or_create_against({"data": []})


async def test_clerk_rejects_an_answer_that_is_not_json() -> None:
    client = httpx2.AsyncClient(
        transport=httpx2.MockTransport(lambda _request: httpx2.Response(200, text="<html>"))
    )
    try:
        users = ClerkBackendUsers(client, "sk_test_secret")  # gitleaks:allow -- fixture
        with pytest.raises(ClerkUnavailableError, match="not JSON"):
            await users.find_or_create_user(MARKETING_EMAIL)
    finally:
        await client.aclose()


async def test_clerk_rejects_a_found_user_with_another_address() -> None:
    with pytest.raises(ClerkUnavailableError, match=re.escape(MARKETING_EMAIL)):
        await _find_or_create_against([_clerk_user("user_other", "someone@example.com")])


class _FakeSession:
    """Answers `_wait_until_ready`'s one query with canned recording rows."""

    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(self, *_exc: object) -> None:
        return None

    async def execute(self, _statement: object) -> SimpleNamespace:
        return SimpleNamespace(all=lambda: self.rows)


def _rows(*states: tuple[uuid.UUID, RecordingState, str | None]) -> Any:
    rows = [SimpleNamespace(id=rid, state=state, error=error) for rid, state, error in states]
    return lambda: _FakeSession(rows)


async def test_wait_names_each_stuck_recording_and_its_state(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(seed_marketing, "READY_TIMEOUT_SECONDS", 0.0)
    ready, stuck, missing = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sessionmaker = _rows(
        (ready, RecordingState.READY, None), (stuck, RecordingState.UPLOADED, None)
    )

    with pytest.raises(SeedRefusedError) as raised:
        await seed_marketing._wait_until_ready(sessionmaker, [ready, stuck, missing])

    message = str(raised.value)
    assert f"{stuck} ({RecordingState.UPLOADED})" in message
    assert f"{missing} (missing)" in message
    assert str(ready) not in message


async def test_wait_fails_fast_on_a_failed_transcode() -> None:
    failed = uuid.uuid4()
    sessionmaker = _rows((failed, RecordingState.FAILED, "decoder error"))

    with pytest.raises(SeedRefusedError, match=f"{failed}: decoder error"):
        await seed_marketing._wait_until_ready(sessionmaker, [failed])


async def test_wait_returns_once_every_recording_is_ready() -> None:
    done = uuid.uuid4()

    await seed_marketing._wait_until_ready(_rows((done, RecordingState.READY, None)), [done])


class _Runner:
    """A job runner with `jobs` queued jobs."""

    def __init__(self, jobs: int) -> None:
        self.jobs = jobs
        self.calls = 0

    async def run_once(self) -> bool:
        self.calls += 1
        if self.jobs == 0:
            return False
        self.jobs -= 1
        return True


async def test_drain_runs_jobs_until_none_are_left() -> None:
    runner = _Runner(jobs=3)

    assert await seed_marketing._drain(runner) == 3
    assert runner.calls == 4


async def test_run_refuses_without_storage(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(seed_marketing, "make_object_store", lambda _settings: None)

    with pytest.raises(SeedRefusedError, match="storage is not configured"):
        await seed_marketing.run(Settings(clerk_secret_key=DEV_KEY), FIXTURE)


def test_main_reports_a_refusal_and_exits_one(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def refuse(_settings: Settings, _fixture: Path) -> None:
        msg = "refusing to seed production"
        raise SeedRefusedError(msg)

    monkeypatch.setattr(seed_marketing, "run", refuse)

    assert seed_marketing.main([]) == 1
    assert "refusing to seed production" in capsys.readouterr().err


def test_main_exits_zero_after_a_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[Path] = []

    async def succeed(_settings: Settings, fixture: Path) -> None:
        seen.append(fixture)

    monkeypatch.setattr(seed_marketing, "run", succeed)

    assert seed_marketing.main(["--fixture", str(FIXTURE)]) == 0
    assert seen == [FIXTURE.resolve()]


async def test_run_hides_from_media_tools_before_transcoding(
    monkeypatch: pytest.MonkeyPatch, database_url: str
) -> None:
    order: list[str] = []
    monkeypatch.setattr(seed_marketing, "hide_from_media_tools", lambda: order.append("hide"))

    async def drain(_runner: object) -> int:
        order.append("drain")
        msg = "stop here"
        raise SeedRefusedError(msg)

    monkeypatch.setattr(seed_marketing, "_drain", drain)
    monkeypatch.setattr(seed_marketing, "make_object_store", lambda _settings: FakeObjectStore())

    async def find_or_create(_self: object, _email: str) -> str:
        return CLERK_ID

    async def fake_seed(*_args: object) -> seed_marketing.SeedResult:
        return seed_marketing.SeedResult()

    monkeypatch.setattr(ClerkBackendUsers, "find_or_create_user", find_or_create)
    monkeypatch.setattr(seed_marketing, "seed", fake_seed)

    settings = Settings(database_url=database_url, clerk_secret_key=DEV_KEY)
    with pytest.raises(SeedRefusedError, match="stop here"):
        await seed_marketing.run(settings, FIXTURE)

    assert order == ["hide", "drain"]
