"""Seed the marketing account in the local database from the marketing capture fixture.

Screenshots of the web app's desktop and Android views sign in to one dedicated account on
the Clerk development instance. This finds or creates that Clerk user, writes the
fixture's rows through the same push path a client uses, uploads each recording and
scan file as a client would, and transcodes the recordings until every one is ready.
Running it again leaves one copy of every row and never deletes the account.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import select

from crosstune.config import Settings
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.http import public_only_client
from crosstune.jobs.media import hide_from_media_tools
from crosstune.jobs.runner import JobRunner
from crosstune.main import make_object_store
from crosstune.models import Recording, Scan
from crosstune.models.user import utc_now
from crosstune.recordings.service import bump_server_seq, enqueue_transcode
from crosstune.schemas.common import Change
from crosstune.schemas.rows import DATA_SCHEMAS, ROW_SCHEMAS
from crosstune.storage.store import PLAYBACK_MIME, SCAN_MIME, scan_key, upload_key
from crosstune.sync.push import apply_push
from crosstune.sync.tables import TABLE_ORDER
from crosstune.users.clerk import ClerkBackendUsers, ClerkUnavailableError
from crosstune.users.service import get_or_create_user
from crosstune.vocabulary import RecordingState, ScanState

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

    from crosstune.storage.store import ObjectStore
    from crosstune.vocabulary import TableName

# The site's capture scripts sign in with this same address. A `+clerk_test` address
# stays in Clerk's test mode, so it signs in with the fixed test code and sends no mail.
MARKETING_EMAIL = "crosstune-marketing+clerk_test@example.com"
DEFAULT_FIXTURE = Path(__file__).resolve().parents[4] / "apple" / "Marketing" / "catalog.json"
READY_TIMEOUT_SECONDS = 120.0
READY_POLL_SECONDS = 1.0

# Clerk prefixes development instance secret keys with this; a live key starts `sk_live_`.
DEVELOPMENT_KEY_PREFIX = "sk_test_"

# Every client derives a user's one settings row id from their Clerk id in this namespace
# (web settingsId, Swift settingsID(clerkUserID:)), so the seeded row must carry it too.
SETTINGS_NAMESPACE = uuid.UUID("5d1c0b8a-3e7f-4a92-9c64-2b8e1f0a7d33")

_AUDIO_TYPES = {".m4a": PLAYBACK_MIME}
_RETRY_STATES = (RecordingState.PENDING_UPLOAD, RecordingState.FAILED)


class SeedRefusedError(Exception):
    """The settings point the seed somewhere it must not write, or the fixture is unusable."""


@dataclass
class SeedResult:
    """What one seed run wrote: applied changes per table, every seeded recording, and the ones sent to transcode."""

    applied: dict[str, int] = field(default_factory=dict)
    recordings: list[uuid.UUID] = field(default_factory=list)
    enqueued: list[uuid.UUID] = field(default_factory=list)


def settings_id(clerk_user_id: str) -> uuid.UUID:
    """The id every client gives this Clerk user's settings row."""
    return uuid.uuid5(SETTINGS_NAMESPACE, clerk_user_id)


def check_target(settings: Settings) -> None:
    """Refuse any database but local development, and any Clerk instance but development.

    Raises:
        SeedRefusedError: The settings name a hosted environment or the end-to-end
            database, or carry no Clerk secret key or one for a live instance.
    """
    if settings.environment != "development":
        msg = f"refusing to seed {settings.environment}: the marketing account is local only"
        raise SeedRefusedError(msg)
    if settings.e2e_database:
        msg = f"refusing to seed {settings.database_name}: the e2e suite owns and resets it"
        raise SeedRefusedError(msg)
    secret = settings.clerk_secret_key.get_secret_value()
    if not secret:
        msg = "CROSSTUNE_CLERK_SECRET_KEY is unset; the seed finds the Clerk user with it"
        raise SeedRefusedError(msg)
    if not secret.startswith(DEVELOPMENT_KEY_PREFIX):
        msg = (
            "refusing to seed: CROSSTUNE_CLERK_SECRET_KEY is not a development instance key "
            f"({DEVELOPMENT_KEY_PREFIX}…), and the marketing account lives only there"
        )
        raise SeedRefusedError(msg)


def _server_owned(table: TableName) -> frozenset[str]:
    """Row fields a client never sends, which the fixture carries for the Swift loader."""
    return frozenset(ROW_SCHEMAS[table].model_fields) - frozenset(DATA_SCHEMAS[table].model_fields)


def _changes(catalog: dict[str, Any], clerk_user_id: str) -> list[Change]:
    """One upsert per fixture row, parents first, stamped now so the fixture's values win."""
    unknown = set(catalog) - set(TABLE_ORDER)
    if unknown:
        msg = f"the fixture holds tables push does not know: {sorted(unknown)}"
        raise SeedRefusedError(msg)
    at = utc_now()
    changes: list[Change] = []
    for table in TABLE_ORDER:
        dropped = _server_owned(table)
        for row in catalog.get(table, []):
            row_id = settings_id(clerk_user_id) if table == "user_settings" else row["id"]
            data = {key: value for key, value in row.items() if key not in dropped}
            changes.append(Change(table=table, op="upsert", id=row_id, updated_at=at, data=data))
    return changes


def _file_for(fixture: Path, files: dict[str, str], table: str, row_id: str) -> Path:
    """The file the fixture names for one recording or scan row.

    Raises:
        SeedRefusedError: The fixture's `files` map has no entry for the row.
    """
    name = files.get(row_id)
    if name is None:
        msg = f"the fixture's files map has no entry for {table} {row_id}"
        raise SeedRefusedError(msg)
    return fixture.parent / name


async def _attach_recording(
    session: AsyncSession, store: ObjectStore, user_id: uuid.UUID, path: Path, row_id: uuid.UUID
) -> bool:
    """Upload a recording's file and queue its transcode, as the uploaded route does.

    Returns:
        bool: True when a transcode was queued; False when the recording already had its
            file confirmed.
    """
    recording = await session.get(Recording, row_id)
    if recording is None or recording.state not in _RETRY_STATES:
        return False
    content_type = _AUDIO_TYPES.get(path.suffix)
    if content_type is None:
        msg = f"{path.name} is not one of the audio types {sorted(_AUDIO_TYPES)}"
        raise SeedRefusedError(msg)
    recording.playback_bytes = await store.upload(
        path, upload_key(user_id, row_id), content_type=content_type
    )
    recording.state = RecordingState.UPLOADED.value
    recording.error = None
    bump_server_seq(recording)
    await enqueue_transcode(session, recording)
    return True


async def _attach_scan(
    session: AsyncSession, store: ObjectStore, user_id: uuid.UUID, path: Path, row_id: uuid.UUID
) -> None:
    """Upload a scan's image and mark it ready, as the uploaded route does."""
    scan = await session.get(Scan, row_id)
    if scan is None or scan.state == ScanState.READY:
        return
    key = scan_key(user_id, row_id)
    scan.file_bytes = await store.upload(path, key, content_type=SCAN_MIME)
    scan.file_key = key
    scan.state = ScanState.READY.value
    bump_server_seq(scan)


async def seed(
    session: AsyncSession, store: ObjectStore, fixture: Path, clerk_user_id: str, email: str
) -> SeedResult:
    """Write the fixture into the account of `clerk_user_id`, creating the user if needed.

    The caller commits. Recordings are left `uploaded` with a transcode queued; a job
    runner turns them `ready`.

    Args:
        session: The session to write through.
        store: The bucket the files go to.
        fixture: The capture catalog; its `files` paths are relative to its folder.
        clerk_user_id: The marketing user on the Clerk instance the API trusts.
        email: The address stored on the user row.

    Returns:
        SeedResult: Applied counts per table and the recordings queued for transcode.

    Raises:
        SeedRefusedError: The fixture holds an unknown table or a recording or scan
            without a file, or push refused a row.
    """
    catalog: dict[str, Any] = json.loads(await asyncio.to_thread(fixture.read_text))
    files: dict[str, str] = catalog.pop("files", {})
    user = await get_or_create_user(session, clerk_user_id, email)

    changes = _changes(catalog, clerk_user_id)
    results = await apply_push(session, user.id, changes)
    refused = [
        f"{r.table} {r.id}: {r.status} {r.reason or ''}" for r in results if r.status != "applied"
    ]
    if refused:
        msg = "push refused fixture rows:\n" + "\n".join(refused)
        raise SeedRefusedError(msg)

    result = SeedResult()
    for change in changes:
        result.applied[change.table] = result.applied.get(change.table, 0) + 1
    for row in catalog.get("recordings", []):
        row_id = uuid.UUID(row["id"])
        result.recordings.append(row_id)
        path = _file_for(fixture, files, "recordings", row["id"])
        if await _attach_recording(session, store, user.id, path, row_id):
            result.enqueued.append(row_id)
    for row in catalog.get("scans", []):
        path = _file_for(fixture, files, "scans", row["id"])
        await _attach_scan(session, store, user.id, path, uuid.UUID(row["id"]))
    await session.flush()
    return result


async def _wait_until_ready(
    sessionmaker: async_sessionmaker[AsyncSession], recording_ids: list[uuid.UUID]
) -> None:
    """Poll until every recording is ready, failing fast on one the transcode failed."""
    deadline = time.monotonic() + READY_TIMEOUT_SECONDS
    while True:
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
            raise SeedRefusedError(msg)
        seen = {row.id for row in rows}
        waiting = [f"{row.id} ({row.state})" for row in rows if row.state != RecordingState.READY]
        waiting += [f"{rid} (missing)" for rid in recording_ids if rid not in seen]
        if not waiting:
            return
        if time.monotonic() > deadline:
            msg = f"recordings not ready after {READY_TIMEOUT_SECONDS:.0f} s: " + ", ".join(waiting)
            raise SeedRefusedError(msg)
        await asyncio.sleep(READY_POLL_SECONDS)


async def _drain(runner: JobRunner) -> int:
    """Run queued jobs until none is left, returning how many ran."""
    count = 0
    while await runner.run_once():
        count += 1
    return count


async def run(settings: Settings, fixture: Path) -> None:
    """Find or create the marketing user, seed its account, and transcode until ready."""
    check_target(settings)
    store = make_object_store(settings)
    if store is None:
        msg = "storage is not configured; run `just api::setup`"
        raise SeedRefusedError(msg)

    http_client = public_only_client(settings.link_resolve_timeout_seconds)
    engine = make_engine(settings.database_url)
    try:
        clerk = ClerkBackendUsers(http_client, settings.clerk_secret_key.get_secret_value())
        clerk_user_id = await clerk.find_or_create_user(MARKETING_EMAIL)
        print(f"marketing user {clerk_user_id} <{MARKETING_EMAIL}> in {settings.database_name}")

        sessionmaker = make_sessionmaker(engine)
        async with sessionmaker() as session, session.begin():
            result = await seed(session, store, fixture, clerk_user_id, MARKETING_EMAIL)
        for table, count in result.applied.items():
            print(f"  {table}: {count}")
        print(f"  transcodes queued: {len(result.enqueued)}")

        # The dev API's runner sleeps until a request of its own wakes it, so a job queued
        # from this process could wait out its idle timer. Draining here makes the seed
        # self-contained; a concurrent runner only claims jobs this one has not.
        hide_from_media_tools()
        runner = JobRunner(sessionmaker, store, http_client=http_client, settings=settings)
        await _drain(runner)
        await _wait_until_ready(sessionmaker, result.recordings)
        print("every recording is ready")
    finally:
        await engine.dispose()
        await http_client.aclose()


def main(argv: list[str] | None = None) -> int:
    """Seed the marketing account from the command line."""
    parser = argparse.ArgumentParser(prog="just api::seed-marketing", description=__doc__)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    args = parser.parse_args(argv)
    try:
        asyncio.run(run(Settings(), args.fixture.resolve()))
    except (SeedRefusedError, ClerkUnavailableError) as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
