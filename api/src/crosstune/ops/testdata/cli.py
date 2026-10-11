"""Seed, clear, or set the billing state of a Clerk development account in the local database.

Run as `just api::testdata ACCOUNT`. The account must already exist on the Clerk
development instance; this only reads from Clerk. With no flags it replaces the account's
data with a fresh seed from the fixture. `--add` seeds on top of what the account holds,
`--clear` leaves it empty, and `--state-only` changes its billing state and nothing else.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
import time
from typing import TYPE_CHECKING
from urllib.parse import urlsplit

from pydantic import ValidationError
from sqlalchemy import func, select

from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.db.locks import lock_user
from crosstune.errors import AccountDeletedError
from crosstune.http import public_only_client
from crosstune.jobs.media import hide_from_media_tools
from crosstune.jobs.runner import JobRunner
from crosstune.main import make_object_store
from crosstune.models import Entitlement, List, Recording, Tune, User
from crosstune.models.user import utc_now
from crosstune.ops.billing import load_settings
from crosstune.ops.testdata.clear import clear_account
from crosstune.ops.testdata.errors import DataCommandError
from crosstune.ops.testdata.fixture import (
    Counts,
    FixtureError,
    build_plan,
    load_fixture,
    resolve_fixture,
)
from crosstune.ops.testdata.seed import (
    GrantSnapshot,
    grant_seed_comp,
    restore_server_grants,
    seed_plan,
    snapshot_server_grants,
)
from crosstune.ops.testdata.state import AccountState, apply_state, refuse_store_subscription
from crosstune.storage.store import delete_best_effort, scan_key, upload_key, user_prefix
from crosstune.sync.tables import TABLE_ORDER, TABLES
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import RecordingState

if TYPE_CHECKING:
    import uuid
    from collections.abc import Awaitable, Callable

    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.config import Settings
    from crosstune.ops.testdata.fixture import Fixture, Plan
    from crosstune.storage.store import ObjectStore
    from crosstune.users.clerk import ClerkUser

logger = logging.getLogger(__name__)

# Clerk prefixes development instance secret keys with this; a live key starts `sk_live_`.
DEVELOPMENT_KEY_PREFIX = "sk_test_"
READY_POLL_SECONDS = 1.0
SIGN_OUT_WARNING = (
    "Sign out of this account on every device first: "
    "a device still holding the old data can push it back."
)


def check_target(settings: Settings) -> None:
    """Print where the command will write, and refuse anything but a development setup.

    Raises:
        DataCommandError: Test data is not enabled, or the settings name another
            environment or the end-to-end database, or carry no Clerk secret key or one
            for a live instance.
    """
    host = urlsplit(settings.database_url).hostname
    print(f"environment {settings.environment}, database {settings.database_name} on {host}")
    if not settings.testdata_enabled:
        msg = "refusing to seed: CROSSTUNE_TESTDATA_ENABLED is not true here"
        raise DataCommandError(msg)
    if settings.environment != "development":
        msg = f"refusing to seed {settings.environment}: test data is development only"
        raise DataCommandError(msg)
    if settings.e2e_database:
        msg = f"refusing to seed {settings.database_name}: the e2e suite owns and resets it"
        raise DataCommandError(msg)
    secret = settings.clerk_secret_key.get_secret_value()
    if not secret:
        msg = "CROSSTUNE_CLERK_SECRET_KEY is unset; the command finds the Clerk user with it"
        raise DataCommandError(msg)
    if not secret.startswith(DEVELOPMENT_KEY_PREFIX):
        msg = (
            "refusing to seed: CROSSTUNE_CLERK_SECRET_KEY is not a development instance key "
            f"({DEVELOPMENT_KEY_PREFIX}…), and test accounts live only there"
        )
        raise DataCommandError(msg)


def _counts(args: argparse.Namespace) -> Counts:
    return Counts(tunes=args.tunes, recordings=args.recordings, scans=args.scans, lists=args.lists)


def _count(text: str) -> int:
    try:
        value = int(text)
    except ValueError:
        msg = f"{text!r} is not a whole number"
        raise argparse.ArgumentTypeError(msg) from None
    if value < 0:
        msg = f"must be 0 or more, got {value}"
        raise argparse.ArgumentTypeError(msg)
    return value


def parse_args(argv: list[str] | None) -> argparse.Namespace:
    """Read the command line, refusing flag combinations that contradict each other.

    Returns:
        argparse.Namespace: The account, the mode flags, the counts, the state, and the fixture.
    """
    parser = argparse.ArgumentParser(prog="just api::testdata", description=__doc__)
    parser.add_argument("account", help="email or Clerk user ID of a development account")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--add", action="store_true", help="seed on top of the existing data")
    mode.add_argument("--clear", action="store_true", help="delete the data and seed nothing")
    parser.add_argument("--tunes", type=_count, help="tunes to seed; default the fixture's")
    parser.add_argument("--recordings", type=_count, help="recordings; default the fixture's")
    parser.add_argument("--scans", type=_count, help="scans; default the fixture's")
    parser.add_argument("--lists", type=_count, help="lists; default the fixture's")
    parser.add_argument(
        "--state",
        choices=[state.value for state in AccountState],
        help=("billing state to leave the account in; default keeps the account's current grants"),
    )
    parser.add_argument("--fixture", default="standard", help="fixture name or folder")
    parser.add_argument(
        "--state-only", action="store_true", help="change the billing state and nothing else"
    )
    args = parser.parse_args(argv)
    if args.state_only:
        if args.state is None:
            parser.error("--state-only needs --state")
        counts = (args.tunes, args.recordings, args.scans, args.lists)
        if args.add or args.clear or any(count is not None for count in counts):
            parser.error(
                "--state-only takes no --add, --clear, --tunes, --recordings, --scans, or --lists"
            )
    return args


def ready_timeout(recordings: int) -> float:
    """How long to wait for `recordings` transcodes before giving up.

    Returns:
        float: Seconds, never under two minutes.
    """
    return max(120.0, 10.0 * recordings)


async def _wait_until_ready(
    sessionmaker: async_sessionmaker[AsyncSession],
    recording_ids: list[uuid.UUID],
    *,
    within: float,
    drain: Callable[[], Awaitable[object]] | None = None,
) -> None:
    """Poll until every recording is ready, failing fast on one the transcode failed.

    `drain` runs before each poll, so a transcode retried after a backoff still runs.
    """
    deadline = time.monotonic() + within
    while True:
        if drain is not None:
            await drain()
        async with sessionmaker() as session:
            rows = (
                await session.execute(
                    select(Recording.id, Recording.state, Recording.error).where(
                        Recording.id.in_(recording_ids)
                    )
                )
            ).all()
        failed = [f"{row.id}: {row.error}" for row in rows if row.state == RecordingState.FAILED]
        if failed:
            msg = "transcode failed for " + ", ".join(failed)
            raise DataCommandError(msg)
        seen = {row.id for row in rows}
        waiting = [f"{row.id} ({row.state})" for row in rows if row.state != RecordingState.READY]
        waiting += [f"{rid} (missing)" for rid in recording_ids if rid not in seen]
        if not waiting:
            return
        if time.monotonic() > deadline:
            msg = f"recordings not ready after {within:.0f} s: " + ", ".join(waiting)
            raise DataCommandError(msg)
        await asyncio.sleep(READY_POLL_SECONDS)


async def _drain(runner: JobRunner) -> int:
    """Run queued jobs until none is left, returning how many ran."""
    count = 0
    while await runner.run_once():
        count += 1
    return count


async def _live_titles(session: AsyncSession, user_id: uuid.UUID) -> frozenset[str]:
    titles = await session.scalars(
        select(Tune.title).where(Tune.owner_user_id == user_id, Tune.deleted_at.is_(None))
    )
    return frozenset(titles)


async def _max_list_position(session: AsyncSession, user_id: uuid.UUID) -> int | None:
    return await session.scalar(
        select(func.max(List.position)).where(List.user_id == user_id, List.deleted_at.is_(None))
    )


async def _live_list_names(session: AsyncSession, user_id: uuid.UUID) -> frozenset[str]:
    names = await session.scalars(
        select(List.name).where(List.user_id == user_id, List.deleted_at.is_(None))
    )
    return frozenset(names)


async def _prepare(
    session: AsyncSession,
    found: ClerkUser,
    settings: Settings,
    args: argparse.Namespace,
) -> tuple[uuid.UUID, uuid.UUID | None]:
    """Provision the account, vet `--state`, and clear it unless asked to keep its data.

    Returns:
        tuple: The account's user id, which a clear replaces, and the id a clear
            deleted, whose files the caller removes once this commits.

    Raises:
        DataCommandError: `--state` was given and a store subscription would refuse it,
            or the Clerk user belongs to a deleted account.
    """
    try:
        if args.add or args.state_only:
            user = await get_or_create_user(session, found.id, found.email, settings)
            await _lock_and_vet(session, user.id, args)
            return user.id, None
        # Provisioning before the clear would claim a pending comp that the clear deletes.
        existing = await session.scalar(select(User.id).where(User.clerk_user_id == found.id))
        if existing is not None:
            await _lock_and_vet(session, existing, args)
        cleared = await clear_account(session, found.id, found.email, settings)
    except AccountDeletedError:
        msg = f"Clerk user {found.id} belongs to a deleted account, which is never re-created"
        raise DataCommandError(msg) from None
    return cleared.user.id, cleared.old_user_id


async def _lock_and_vet(
    session: AsyncSession, user_id: uuid.UUID, args: argparse.Namespace
) -> None:
    await lock_user(session, user_id)
    if args.state is not None:
        # Refused before the clear, which would cascade the store grant away, and
        # before the seed's comp exists, so a refusal never strands it.
        await refuse_store_subscription(session, user_id, utc_now())


def _planned_keys(user_id: uuid.UUID, plan: Plan) -> list[str]:
    return [upload_key(user_id, planned.id) for planned in plan.recordings] + [
        scan_key(user_id, planned.id) for planned in plan.scans
    ]


async def _seed(
    sessionmaker: async_sessionmaker[AsyncSession],
    store: ObjectStore,
    user_id: uuid.UUID,
    fixture: Fixture,
    settings: Settings,
    args: argparse.Namespace,
) -> tuple[GrantSnapshot, list[uuid.UUID]]:
    """Seed the account under a temporary comp in one transaction.

    Uploads happen before the commit, so a failed seed deletes the files it planned
    before the error propagates.

    Returns:
        tuple: The grants the account held before the comp, and the recordings
            queued for transcode.
    """
    plan: Plan | None = None
    try:
        async with sessionmaker() as session, session.begin():
            await lock_user(session, user_id)
            user = await session.get_one(User, user_id)
            now = utc_now()
            taken = await _live_titles(session, user_id) if args.add else frozenset()
            last_list = await _max_list_position(session, user_id) if args.add else None
            list_names = await _live_list_names(session, user_id) if args.add else frozenset()
            plan = build_plan(
                fixture,
                _counts(args),
                now=now,
                taken_titles=taken,
                taken_list_names=list_names,
                list_start=0 if last_list is None else last_list + 1,
            )
            snapshot = await snapshot_server_grants(session, user_id)
            await grant_seed_comp(session, user_id, settings, now)
            enqueued = await seed_plan(session, store, user, plan, settings)
    except BaseException:
        if plan is not None:
            await delete_best_effort(
                store,
                _planned_keys(user_id, plan),
                log=logger,
                message="could not delete the files of a failed seed",
            )
        raise
    return snapshot, enqueued


async def _report(session: AsyncSession, user_id: uuid.UUID) -> None:
    for table in TABLE_ORDER:
        spec = TABLES[table]
        count = await session.scalar(
            select(func.count()).select_from(spec.model).where(spec.owned_by(user_id))
        )
        print(f"  {table}: {count}")
    source = await session.scalar(
        select(Entitlement.premium_source).where(Entitlement.user_id == user_id)
    )
    print(f"premium_source {source}")


async def _find(clerk: ClerkBackendUsers, account: str) -> ClerkUser:
    """The Clerk user the command works on, which must already exist.

    Raises:
        DataCommandError: The account is neither an email nor a Clerk user ID, or
            Clerk has no such user.
    """
    try:
        found = await clerk.find_user(account)
    except ValueError as exc:
        raise DataCommandError(str(exc)) from exc
    if found is None:
        msg = (
            f"no Clerk development user {account}: "
            "sign up in the app with that email, then run this again"
        )
        raise DataCommandError(msg)
    return found


async def _settle(
    sessionmaker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    snapshot: GrantSnapshot | None,
    state: str | None,
    settings: Settings,
) -> None:
    """Put back the grants the seed's comp replaced, then move the account into `state`.

    The restore commits on its own first, so the comp never outlives the command even
    when `state` is refused.
    """
    if snapshot is not None:
        await _restore(sessionmaker, user_id, snapshot, settings)
    if state is not None:
        async with sessionmaker() as session, session.begin():
            await apply_state(session, user_id, AccountState(state), settings, utc_now())


async def _restore(
    sessionmaker: async_sessionmaker[AsyncSession],
    user_id: uuid.UUID,
    snapshot: GrantSnapshot,
    settings: Settings,
) -> None:
    async with sessionmaker() as session, session.begin():
        await restore_server_grants(session, user_id, snapshot, settings, utc_now())


async def run(settings: Settings, args: argparse.Namespace) -> None:
    """Find the Clerk user, then clear, seed, or set the billing state of its account.

    Raises:
        DataCommandError: The target is refused, storage is not configured, or the
            account is not an email or Clerk user ID that Clerk knows.
    """
    check_target(settings)
    store = make_object_store(settings)
    if store is None:
        msg = "storage is not configured; run `just api::setup`"
        raise DataCommandError(msg)
    seeding = not (args.clear or args.state_only)
    fixture = load_fixture(resolve_fixture(args.fixture)) if seeding else None
    if fixture is not None:
        # Refuse impossible counts before anything is cleared. The seed plans again
        # with the account's own titles and list positions.
        build_plan(fixture, _counts(args), now=utc_now())

    http_client = public_only_client(settings.link_resolve_timeout_seconds)
    engine = make_engine(settings.database_url)
    try:
        clerk = ClerkBackendUsers(http_client, settings.clerk_secret_key.get_secret_value())
        found = await _find(clerk, args.account)
        print(f"Clerk user {found.id} <{found.email}>")
        if not (args.add or args.state_only):
            print(SIGN_OUT_WARNING)

        sessionmaker = make_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            user_id, old_user_id = await _prepare(session, found, settings, args)
        if old_user_id is not None:
            await store.delete_prefix(user_prefix(old_user_id))

        snapshot: GrantSnapshot | None = None
        try:
            if fixture is not None:
                snapshot, recordings = await _seed(
                    sessionmaker, store, user_id, fixture, settings, args
                )
                # The dev API's runner sleeps until a request of its own wakes it, so a job
                # queued from this process could wait out its idle timer. Draining here
                # makes the command self-contained; a concurrent runner only claims jobs
                # this one has not.
                hide_from_media_tools()
                runner = JobRunner(
                    sessionmaker,
                    store,
                    orphan_sweep_seconds=None,
                    http_client=http_client,
                    settings=settings,
                )
                await _wait_until_ready(
                    sessionmaker,
                    recordings,
                    within=ready_timeout(len(recordings)),
                    drain=lambda: _drain(runner),
                )
                print("every recording is ready")
        except BaseException as error:
            if snapshot is not None:
                try:
                    await _settle(sessionmaker, user_id, snapshot, args.state, settings)
                except Exception as settle_error:  # noqa: BLE001 -- reported with the first error
                    error.add_note(f"then settling the billing state failed: {settle_error}")
            raise
        if snapshot is not None or args.state is not None:
            await _settle(sessionmaker, user_id, snapshot, args.state, settings)

        async with sessionmaker() as session:
            await _report(session, user_id)
    finally:
        await engine.dispose()
        await http_client.aclose()


def main(argv: list[str] | None = None) -> int:
    """Run the test data command from the command line."""
    args = parse_args(argv)
    try:
        asyncio.run(run(load_settings(), args))
    except ValidationError as exc:
        problems = "; ".join(str(error["msg"]) for error in exc.errors())
        print(f"unusable settings: {problems}", file=sys.stderr)
        return 1
    except (DataCommandError, FixtureError, ClerkUnavailableError) as exc:
        print(exc, *getattr(exc, "__notes__", ()), sep="\n", file=sys.stderr)
        return 1
    return 0
