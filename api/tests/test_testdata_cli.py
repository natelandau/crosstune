"""The test data command line."""

from __future__ import annotations

import uuid
from datetime import timedelta
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any, Self

import pytest
from sqlalchemy import func, select

from crosstune.billing.access import refresh_entitlement
from crosstune.config import Settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.models import Entitlement, Grant, List, PendingComp, Tune, User
from crosstune.models.user import utc_now
from crosstune.ops.testdata import cli
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.fixture import DEFAULT_FIXTURES_DIR, FixtureError, load_fixture
from crosstune.ops.testdata.seed import SEED_REASON
from crosstune.storage.store import user_prefix
from crosstune.sync.tables import TABLE_ORDER, TABLES
from crosstune.users.clerk import ClerkBackendUsers, ClerkUser
from crosstune.vocabulary import GrantKind, GrantSource, RecordingState
from tests.fakes import FakeObjectStore

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    from sqlalchemy.ext.asyncio import AsyncEngine

pytestmark = pytest.mark.anyio

DEV_KEY = "sk_test_x"  # gitleaks:allow -- fixture
LIVE_KEY = "sk_live_x"  # gitleaks:allow -- fixture
CLERK_ID = "user_testdata_cli"
EMAIL = "cli+clerk_test@example.com"
STANDARD = load_fixture(DEFAULT_FIXTURES_DIR / "standard")
# One more tune than [names] has titles for.
TOO_MANY_TUNES = len(set(STANDARD.names.first)) * len(set(STANDARD.names.second)) + 1


def test_check_target_refuses_the_e2e_database() -> None:
    settings = Settings(
        testdata_enabled=True,
        database_url="postgresql+asyncpg://crosstune:crosstune@localhost:5432/crosstune_e2e",
        clerk_secret_key=DEV_KEY,
    )
    with pytest.raises(DataCommandError, match="e2e"):
        cli.check_target(settings)


def test_check_target_refuses_a_hosted_environment() -> None:
    with pytest.raises(DataCommandError, match="production"):
        cli.check_target(
            Settings(
                testdata_enabled=True,
                environment="production",
                clerk_issuer="https://x",
                clerk_secret_key="sk",
                clerk_authorized_parties=["https://x"],
            )
        )


def test_check_target_refuses_when_not_enabled() -> None:
    with pytest.raises(DataCommandError, match="CROSSTUNE_TESTDATA_ENABLED"):
        cli.check_target(Settings(clerk_secret_key=DEV_KEY))


def test_check_target_refuses_a_live_clerk_key() -> None:
    with pytest.raises(DataCommandError, match="development instance"):
        cli.check_target(Settings(testdata_enabled=True, clerk_secret_key=LIVE_KEY))


def test_check_target_needs_the_clerk_secret() -> None:
    with pytest.raises(DataCommandError, match="CROSSTUNE_CLERK_SECRET_KEY"):
        cli.check_target(Settings(testdata_enabled=True, clerk_secret_key=""))


def test_check_target_accepts_the_development_database(
    capsys: pytest.CaptureFixture[str],
) -> None:
    cli.check_target(Settings(testdata_enabled=True, clerk_secret_key=DEV_KEY))

    assert "environment development, database" in capsys.readouterr().out


def test_parse_args_add_and_clear_exclusive() -> None:
    with pytest.raises(SystemExit):
        cli.parse_args([EMAIL, "--add", "--clear"])


def test_parse_args_state_only_needs_state() -> None:
    with pytest.raises(SystemExit):
        cli.parse_args([EMAIL, "--state-only"])


@pytest.mark.parametrize(
    "extra",
    [
        ["--add"],
        ["--clear"],
        ["--tunes", "3"],
        ["--recordings", "1"],
        ["--scans", "1"],
        ["--lists", "1"],
    ],
)
def test_parse_args_state_only_refuses_other_work(extra: list[str]) -> None:
    with pytest.raises(SystemExit):
        cli.parse_args([EMAIL, "--state-only", "--state", "trial", *extra])


def test_parse_args_rejects_negative_counts() -> None:
    with pytest.raises(SystemExit):
        cli.parse_args([EMAIL, "--tunes", "-1"])


def test_parse_args_defaults() -> None:
    args = cli.parse_args([EMAIL])

    assert (args.account, args.fixture, args.add, args.clear, args.state_only) == (
        EMAIL,
        "standard",
        False,
        False,
        False,
    )
    assert (args.tunes, args.recordings, args.scans, args.state) == (None, None, None, None)


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


async def test_wait_names_each_stuck_recording_and_its_state() -> None:
    ready, stuck, missing = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    sessionmaker = _rows(
        (ready, RecordingState.READY, None), (stuck, RecordingState.UPLOADED, None)
    )

    with pytest.raises(DataCommandError) as raised:
        await cli._wait_until_ready(sessionmaker, [ready, stuck, missing], within=0.0)

    message = str(raised.value)
    assert f"{stuck} ({RecordingState.UPLOADED})" in message
    assert f"{missing} (missing)" in message
    assert str(ready) not in message


async def test_wait_fails_fast_on_a_failed_transcode() -> None:
    failed = uuid.uuid4()
    sessionmaker = _rows((failed, RecordingState.FAILED, "decoder error"))

    with pytest.raises(DataCommandError, match=f"{failed}: decoder error"):
        await cli._wait_until_ready(sessionmaker, [failed], within=60.0)


async def test_wait_returns_once_every_recording_is_ready() -> None:
    done = uuid.uuid4()

    await cli._wait_until_ready(_rows((done, RecordingState.READY, None)), [done], within=60.0)


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

    assert await cli._drain(runner) == 3
    assert runner.calls == 4


async def test_wait_drains_before_each_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    """A transcode retried after a backoff is run by a later drain, not left to the API."""
    done = uuid.uuid4()
    states = iter([RecordingState.UPLOADED, RecordingState.READY])
    drains: list[None] = []

    def sessionmaker() -> _FakeSession:
        return _FakeSession([SimpleNamespace(id=done, state=next(states), error=None)])

    async def drain() -> None:
        drains.append(None)

    monkeypatch.setattr(cli, "READY_POLL_SECONDS", 0.0)

    await cli._wait_until_ready(sessionmaker, [done], within=60.0, drain=drain)

    assert len(drains) == 2


def test_wait_timeout_grows_with_the_recordings() -> None:
    assert cli.ready_timeout(0) == 120
    assert cli.ready_timeout(30) == 300


@pytest.fixture
def cli_settings(database_url: str) -> Settings:
    return Settings(testdata_enabled=True, database_url=database_url, clerk_secret_key=DEV_KEY)


@pytest.fixture
async def db(cli_settings: Settings, truncate_all: None) -> AsyncIterator[AsyncEngine]:
    """The run commits, so every committed row is truncated after the test."""
    engine = make_engine(cli_settings.database_url)
    yield engine
    await engine.dispose()


@pytest.fixture
def clerk(monkeypatch: pytest.MonkeyPatch) -> dict[str, ClerkUser]:
    """A Clerk that knows only the users the test puts in the returned dict."""
    users = {EMAIL: ClerkUser(id=CLERK_ID, email=EMAIL)}

    async def find_user(_self: object, account: str) -> ClerkUser | None:
        return users.get(account)

    monkeypatch.setattr(ClerkBackendUsers, "find_user", find_user)
    return users


@pytest.fixture
def store(monkeypatch: pytest.MonkeyPatch) -> FakeObjectStore:
    store = FakeObjectStore()
    monkeypatch.setattr(cli, "make_object_store", lambda _settings: store)
    return store


@pytest.fixture
def no_transcode(monkeypatch: pytest.MonkeyPatch) -> list[list[uuid.UUID]]:
    """Skip the transcode drain and wait, recording which recordings the run waited on."""
    waited: list[list[uuid.UUID]] = []

    async def drain(_runner: object) -> int:
        return 0

    async def wait(_sessionmaker: object, recording_ids: list[uuid.UUID], **_kw: object) -> None:
        waited.append(list(recording_ids))

    monkeypatch.setattr(cli, "hide_from_media_tools", lambda: None)
    monkeypatch.setattr(cli, "_drain", drain)
    monkeypatch.setattr(cli, "_wait_until_ready", wait)
    return waited


async def _run(settings: Settings, *argv: str) -> None:
    await cli.run(settings, cli.parse_args([EMAIL, *argv]))


async def _state(engine: AsyncEngine) -> tuple[dict[str, int], str | None, list[str]]:
    """Row counts per table, the premium source, and the live tune titles of the account."""
    async with engine.connect() as conn:
        user_id = await conn.scalar(select(User.id).where(User.clerk_user_id == CLERK_ID))
        counts = {}
        for table in TABLE_ORDER:
            spec = TABLES[table]
            counts[table] = await conn.scalar(
                select(func.count()).select_from(spec.model).where(spec.owned_by(user_id))
            )
        source = await conn.scalar(
            select(Entitlement.premium_source).where(Entitlement.user_id == user_id)
        )
        titles = list(
            await conn.scalars(
                select(Tune.title).where(Tune.owner_user_id == user_id, Tune.deleted_at.is_(None))
            )
        )
    return counts, source, titles


@pytest.mark.usefixtures("store", "no_transcode")
async def test_run_unknown_account_tells_to_sign_up(
    cli_settings: Settings, clerk: dict[str, ClerkUser]
) -> None:
    clerk.clear()

    with pytest.raises(DataCommandError, match="sign up"):
        await _run(cli_settings)


@pytest.mark.usefixtures("store", "no_transcode")
async def test_run_refuses_an_account_that_is_neither_email_nor_id(
    cli_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def find_user(_self: object, account: str) -> ClerkUser | None:
        msg = f"{account} is neither a Clerk user ID (user_...) nor an email"
        raise ValueError(msg)

    monkeypatch.setattr(ClerkBackendUsers, "find_user", find_user)

    with pytest.raises(DataCommandError, match="neither"):
        await cli.run(cli_settings, cli.parse_args(["nobody"]))


async def test_run_refuses_without_storage(
    cli_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "make_object_store", lambda _settings: None)

    with pytest.raises(DataCommandError, match="storage is not configured"):
        await _run(cli_settings)


@pytest.mark.usefixtures("clerk", "store")
async def test_run_fresh_seeds_and_restores_trial(
    cli_settings: Settings,
    db: AsyncEngine,
    no_transcode: list[list[uuid.UUID]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    fixture = load_fixture(DEFAULT_FIXTURES_DIR / "standard")

    await _run(cli_settings)

    counts, source, _ = await _state(db)
    assert counts["tunes"] == fixture.tunes.count
    assert counts["recordings"] == fixture.recordings.count
    assert counts["scans"] == fixture.scans.count
    assert source == "trial"
    assert len(no_transcode) == 1
    assert len(no_transcode[0]) == fixture.recordings.count
    out = capsys.readouterr().out
    assert CLERK_ID in out
    assert cli.SIGN_OUT_WARNING in out
    assert "premium_source trial" in out


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_with_state_premium_ends_comped(cli_settings: Settings, db: AsyncEngine) -> None:
    await _run(
        cli_settings, "--tunes", "2", "--recordings", "0", "--scans", "0", "--state", "premium"
    )

    counts, source, _ = await _state(db)
    assert counts["tunes"] == 2
    assert source == "comp"


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_add_keeps_existing_rows(
    cli_settings: Settings, db: AsyncEngine, capsys: pytest.CaptureFixture[str]
) -> None:
    argv = ("--add", "--tunes", "3", "--recordings", "0", "--scans", "0")
    await _run(cli_settings, *argv)
    await _run(cli_settings, *argv)

    counts, source, titles = await _state(db)
    assert counts["tunes"] == 6
    assert len(set(titles)) == 6
    assert source == "trial"
    assert cli.SIGN_OUT_WARNING not in capsys.readouterr().out


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_replaces_existing_rows(cli_settings: Settings, db: AsyncEngine) -> None:
    argv = ("--tunes", "3", "--recordings", "0", "--scans", "0")
    await _run(cli_settings, *argv)
    await _run(cli_settings, *argv)

    counts, _, _ = await _state(db)
    assert counts["tunes"] == 3


@pytest.mark.usefixtures("clerk", "no_transcode")
async def test_run_clear_leaves_empty_account(
    cli_settings: Settings, db: AsyncEngine, store: FakeObjectStore
) -> None:
    await _run(cli_settings, "--tunes", "3", "--recordings", "1", "--scans", "1")
    assert store.keys()

    await _run(cli_settings, "--clear")

    counts, source, _ = await _state(db)
    assert {table: n for table, n in counts.items() if n} == {"entitlements": 1}
    assert source == "trial"
    assert store.keys() == []


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_clear_with_state_sets_it(cli_settings: Settings, db: AsyncEngine) -> None:
    await _run(cli_settings, "--clear", "--state", "premium")

    _, source, _ = await _state(db)
    assert source == "comp"


@pytest.mark.usefixtures("clerk", "store")
async def test_run_state_only_leaves_data(
    cli_settings: Settings,
    db: AsyncEngine,
    no_transcode: list[list[uuid.UUID]],
    capsys: pytest.CaptureFixture[str],
) -> None:
    await _run(cli_settings, "--tunes", "3", "--recordings", "1", "--scans", "1")
    before, _, _ = await _state(db)
    capsys.readouterr()

    await _run(cli_settings, "--state-only", "--state", "lapsed")

    after, source, _ = await _state(db)
    assert after == before
    assert source is None
    assert len(no_transcode) == 1
    assert cli.SIGN_OUT_WARNING not in capsys.readouterr().out


@pytest.mark.usefixtures("clerk", "store")
async def test_run_restores_grants_when_the_transcode_fails(
    cli_settings: Settings, db: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "hide_from_media_tools", lambda: None)

    async def drain(_runner: object) -> int:
        msg = "transcode failed"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "_drain", drain)

    with pytest.raises(DataCommandError, match="transcode failed"):
        await _run(cli_settings, "--tunes", "1", "--recordings", "1", "--scans", "0")

    counts, source, _ = await _state(db)
    assert counts["recordings"] == 1
    assert source == "trial"


def test_main_reports_a_refusal_and_exits_one(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def refuse(_settings: Settings, _args: object) -> None:
        msg = "refusing to seed production"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "run", refuse)
    monkeypatch.setattr(
        cli, "load_settings", lambda: Settings(testdata_enabled=True, clerk_secret_key=DEV_KEY)
    )

    assert cli.main([EMAIL]) == 1
    assert "refusing to seed production" in capsys.readouterr().err


@pytest.mark.parametrize(
    "error", [cli.FixtureError("bad toml"), cli.ClerkUnavailableError("clerk is down")]
)
def test_main_reports_other_errors_and_exits_one(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str], error: Exception
) -> None:
    async def fail(_settings: Settings, _args: object) -> None:
        raise error

    monkeypatch.setattr(cli, "run", fail)
    monkeypatch.setattr(
        cli, "load_settings", lambda: Settings(testdata_enabled=True, clerk_secret_key=DEV_KEY)
    )

    assert cli.main([EMAIL]) == 1
    assert str(error) in capsys.readouterr().err


def test_main_exits_zero_after_a_run(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    async def succeed(_settings: Settings, args: Any) -> None:
        seen.append(args.account)

    monkeypatch.setattr(cli, "run", succeed)
    monkeypatch.setattr(
        cli, "load_settings", lambda: Settings(testdata_enabled=True, clerk_secret_key=DEV_KEY)
    )

    assert cli.main([EMAIL]) == 0
    assert seen == [EMAIL]


async def _user_id(engine: AsyncEngine) -> uuid.UUID:
    async with engine.connect() as conn:
        return await conn.scalar(select(User.id).where(User.clerk_user_id == CLERK_ID))


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_refuses_a_state_a_store_subscription_outranks(
    cli_settings: Settings, db: AsyncEngine
) -> None:
    await _run(cli_settings, "--tunes", "2", "--recordings", "0", "--scans", "0")
    user_id = await _user_id(db)
    now = utc_now()
    async with make_sessionmaker(db)() as session, session.begin():
        session.add(
            Grant(
                user_id=user_id,
                kind=GrantKind.PREMIUM.value,
                source=GrantSource.APPLE.value,
                expires_at=now + timedelta(days=30),
            )
        )
        await refresh_entitlement(session, user_id, cli_settings, now)

    with pytest.raises(DataCommandError, match="apple"):
        await _run(cli_settings, "--add", "--tunes", "1", "--state", "premium")

    counts, source, _ = await _state(db)
    assert counts["tunes"] == 2
    assert source == "apple"
    async with db.connect() as conn:
        seed_comps = await conn.scalar(
            select(func.count()).select_from(Grant).where(Grant.reason == SEED_REASON)
        )
    assert seed_comps == 0


@pytest.mark.usefixtures("clerk", "no_transcode")
async def test_run_failed_seed_leaves_the_account_cleared(
    cli_settings: Settings,
    db: AsyncEngine,
    store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _run(cli_settings, "--tunes", "2", "--recordings", "1", "--scans", "1")
    old_id = await _user_id(db)
    seed_plan = cli.seed_plan

    async def upload_then_fail(*args: Any) -> list[uuid.UUID]:
        await seed_plan(*args)
        msg = "seed broke"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "seed_plan", upload_then_fail)

    with pytest.raises(DataCommandError, match="seed broke"):
        await _run(cli_settings, "--tunes", "2", "--recordings", "1", "--scans", "1")

    new_id = await _user_id(db)
    assert new_id != old_id
    counts, source, _ = await _state(db)
    assert {table: n for table, n in counts.items() if n} == {"entitlements": 1}
    assert source == "trial"
    assert await store.list_keys(user_prefix(old_id)) == []
    assert await store.list_keys(user_prefix(new_id)) == []


@pytest.mark.usefixtures("clerk", "store")
async def test_run_waits_only_on_queued_transcodes(
    cli_settings: Settings,
    db: AsyncEngine,
    no_transcode: list[list[uuid.UUID]],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    seed_plan = cli.seed_plan

    async def queue_one(*args: Any) -> list[uuid.UUID]:
        return (await seed_plan(*args))[:1]

    monkeypatch.setattr(cli, "seed_plan", queue_one)

    await _run(cli_settings, "--tunes", "2", "--recordings", "2", "--scans", "0")

    assert [len(ids) for ids in no_transcode] == [1]
    assert (await _state(db))[0]["recordings"] == 2


@pytest.mark.usefixtures("clerk", "store")
async def test_run_reports_a_failed_state_with_the_first_error(
    cli_settings: Settings, db: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(cli, "hide_from_media_tools", lambda: None)

    async def drain(_runner: object) -> int:
        msg = "transcode failed"
        raise DataCommandError(msg)

    async def refuse_state(*_args: object) -> None:
        msg = "state refused"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "_drain", drain)
    monkeypatch.setattr(cli, "apply_state", refuse_state)

    with pytest.raises(DataCommandError, match="transcode failed") as raised:
        await _run(cli_settings, "--tunes", "1", "--recordings", "1", "--state", "premium")

    assert any("state refused" in note for note in raised.value.__notes__)
    _, source, _ = await _state(db)
    assert source == "trial"


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_restores_grants_when_the_state_is_refused(
    cli_settings: Settings, db: AsyncEngine, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def refuse_state(*_args: object) -> None:
        msg = "state refused"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "apply_state", refuse_state)

    with pytest.raises(DataCommandError, match="state refused"):
        await _run(
            cli_settings, "--tunes", "1", "--recordings", "0", "--scans", "0", "--state", "premium"
        )

    _, source, _ = await _state(db)
    assert source == "trial"


def test_main_prints_the_notes_of_an_error(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fail(_settings: Settings, _args: object) -> None:
        error = DataCommandError("transcode failed")
        error.add_note("then settling the billing state failed: state refused")
        raise error

    monkeypatch.setattr(cli, "run", fail)
    monkeypatch.setattr(
        cli, "load_settings", lambda: Settings(testdata_enabled=True, clerk_secret_key=DEV_KEY)
    )

    assert cli.main([EMAIL]) == 1
    err = capsys.readouterr().err
    assert "transcode failed" in err
    assert "state refused" in err


async def _add_apple_subscription(engine: AsyncEngine, settings: Settings) -> None:
    user_id = await _user_id(engine)
    now = utc_now()
    async with make_sessionmaker(engine)() as session, session.begin():
        session.add(
            Grant(
                user_id=user_id,
                kind=GrantKind.PREMIUM.value,
                source=GrantSource.APPLE.value,
                expires_at=now + timedelta(days=30),
            )
        )
        await refresh_entitlement(session, user_id, settings, now)


@pytest.mark.usefixtures("clerk", "no_transcode")
@pytest.mark.parametrize(
    "argv",
    [
        ("--tunes", "0"),
        ("--tunes", "1", "--scans", "21"),
        ("--tunes", str(TOO_MANY_TUNES), "--recordings", "0", "--scans", "0"),
    ],
)
async def test_run_bad_count_leaves_existing_rows(
    cli_settings: Settings, db: AsyncEngine, store: FakeObjectStore, argv: tuple[str, ...]
) -> None:
    await _run(cli_settings, "--tunes", "2", "--recordings", "1", "--scans", "1")
    user_id = await _user_id(db)
    keys = store.keys()

    with pytest.raises(FixtureError):
        await _run(cli_settings, *argv)

    assert await _user_id(db) == user_id
    counts, _, _ = await _state(db)
    assert (counts["tunes"], counts["recordings"], counts["scans"]) == (2, 1, 1)
    assert store.keys() == keys


@pytest.mark.usefixtures("clerk", "no_transcode")
@pytest.mark.parametrize("argv", [(), ("--clear",)])
async def test_run_with_state_refuses_a_store_subscription_before_clearing(
    cli_settings: Settings, db: AsyncEngine, store: FakeObjectStore, argv: tuple[str, ...]
) -> None:
    await _run(cli_settings, "--tunes", "2", "--recordings", "1", "--scans", "0")
    await _add_apple_subscription(db, cli_settings)
    user_id = await _user_id(db)
    keys = store.keys()

    with pytest.raises(DataCommandError, match="apple"):
        await _run(cli_settings, *argv, "--state", "lapsed")

    assert await _user_id(db) == user_id
    counts, source, _ = await _state(db)
    assert (counts["tunes"], counts["recordings"]) == (2, 1)
    assert source == "apple"
    assert store.keys() == keys


@pytest.mark.usefixtures("clerk", "no_transcode")
async def test_run_failed_clear_keeps_the_files(
    cli_settings: Settings,
    db: AsyncEngine,
    store: FakeObjectStore,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    await _run(cli_settings, "--tunes", "2", "--recordings", "1", "--scans", "1")
    user_id = await _user_id(db)
    keys = store.keys()
    clear_account = cli.clear_account

    async def clear_then_fail(*args: Any) -> Any:
        await clear_account(*args)
        msg = "clear broke"
        raise DataCommandError(msg)

    monkeypatch.setattr(cli, "clear_account", clear_then_fail)

    with pytest.raises(DataCommandError, match="clear broke"):
        await _run(cli_settings, "--clear")

    assert await _user_id(db) == user_id
    assert (await _state(db))[0]["recordings"] == 1
    assert store.keys() == keys


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
@pytest.mark.parametrize("state", ["trial", "lapsed", "premium"])
async def test_run_with_state_leaves_no_seed_comp(
    cli_settings: Settings, db: AsyncEngine, state: str
) -> None:
    await _run(cli_settings, "--tunes", "1", "--recordings", "1", "--scans", "0", "--state", state)

    async with db.connect() as conn:
        seed_comps = await conn.scalar(
            select(func.count()).select_from(Grant).where(Grant.reason == SEED_REASON)
        )
    assert seed_comps == 0


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_add_puts_lists_after_existing(cli_settings: Settings, db: AsyncEngine) -> None:
    argv = ("--add", "--tunes", "3", "--recordings", "0", "--scans", "0")
    await _run(cli_settings, *argv)
    await _run(cli_settings, *argv)

    user_id = await _user_id(db)
    async with db.connect() as conn:
        positions = list(
            await conn.scalars(
                select(List.position).where(List.user_id == user_id).order_by(List.position)
            )
        )
    assert STANDARD.lists is not None
    assert positions == list(range(2 * STANDARD.lists.count))


@pytest.mark.usefixtures("clerk", "store", "no_transcode")
async def test_run_clear_of_a_new_account_keeps_its_pending_comp(
    cli_settings: Settings, db: AsyncEngine
) -> None:
    async with make_sessionmaker(db)() as session, session.begin():
        session.add(PendingComp(email=EMAIL, granted_by="test", reason="promised"))

    await _run(cli_settings, "--clear")

    _, source, _ = await _state(db)
    assert source == "comp"
