"""Operator command that renames existing recordings with the street-address naming rules.

Run as `just api::places rename-automatic`. It re-looks-up every live recording whose
coordinates came from a device fix or a file and whose name the server wrote, at a paced rate that
stays well inside Apple Maps' daily quota. A name the musician picked is never touched.
Prints the environment and database first and refuses production without `--yes`.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from dataclasses import dataclass
from typing import TYPE_CHECKING, Protocol

from pydantic import ValidationError
from sqlalchemy import select

from crosstune.db.base import bump_server_seq
from crosstune.db.engine import make_engine, make_sessionmaker
from crosstune.db.locks import lock_user
from crosstune.http import public_only_client
from crosstune.models import Recording
from crosstune.ops.billing import BillingCommandError, check_target, load_settings
from crosstune.places.maps import MapsBusyError, MapsError, configured_maps
from crosstune.vocabulary import PlaceOrigin

if TYPE_CHECKING:
    import uuid
    from collections.abc import Awaitable, Callable

    import httpx2
    from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

DEFAULT_PER_SECOND = 2.0
# A busy Maps key is waited out this many times for one recording before it counts as failed.
_BUSY_ATTEMPTS = 3
_MAX_BUSY_WAIT_SECONDS = 300.0
_OUTAGE_WAIT_SECONDS = 5.0


class _Namer(Protocol):
    async def reverse_name(
        self,
        client: httpx2.AsyncClient,
        lat: float,
        lon: float,
        *,
        accuracy_m: int | None,
        timeout: float,  # noqa: ASYNC109
    ) -> str | None: ...


@dataclass(slots=True)
class RenameCounts:
    """What a run did: renamed (or would rename), unchanged, skipped, and failed recordings."""

    renamed: int = 0
    unchanged: int = 0
    skipped: int = 0
    failed: int = 0


@dataclass(frozen=True, slots=True)
class _Candidate:
    id: uuid.UUID
    user_id: uuid.UUID
    lat: float
    lon: float
    name: str
    accuracy_m: int | None
    origin: str | None


async def _candidates(sessionmaker: async_sessionmaker[AsyncSession]) -> list[_Candidate]:
    stmt = (
        select(Recording)
        .where(
            Recording.deleted_at.is_(None),
            Recording.place_origin.in_((PlaceOrigin.DEVICE.value, PlaceOrigin.FILE.value)),
            Recording.place_name.is_not(None),
            Recording.place_lat.is_not(None),
            Recording.place_lon.is_not(None),
        )
        .order_by(Recording.id)
    )
    async with sessionmaker() as session:
        return [
            _Candidate(
                rec.id,
                rec.user_id,
                rec.place_lat,
                rec.place_lon,
                rec.place_name,
                rec.place_accuracy_m,
                rec.place_origin,
            )
            for rec in await session.scalars(stmt)
            if rec.place_lat is not None and rec.place_lon is not None and rec.place_name
        ]


async def _lookup(
    maps: _Namer,
    client: httpx2.AsyncClient,
    item: _Candidate,
    *,
    timeout: float,  # noqa: ASYNC109
    sleep: Callable[[float], Awaitable[None]],
) -> str | None:
    """Name one recording, waiting out a busy key; raises MapsError when Maps stays unavailable."""
    for attempt in range(_BUSY_ATTEMPTS):
        try:
            return await maps.reverse_name(
                client, item.lat, item.lon, accuracy_m=item.accuracy_m, timeout=timeout
            )
        except MapsBusyError as error:
            if attempt == _BUSY_ATTEMPTS - 1:
                raise
            await sleep(min(error.retry_after_seconds, _MAX_BUSY_WAIT_SECONDS))
        except MapsError as error:
            if error.transient:
                await sleep(_OUTAGE_WAIT_SECONDS)
            raise
    raise AssertionError  # pragma: no cover


async def _write(
    sessionmaker: async_sessionmaker[AsyncSession], item: _Candidate, name: str
) -> bool:
    """Store the new name if the recording's coordinates and name are what the lookup saw."""
    async with sessionmaker() as session, session.begin():
        await lock_user(session, item.user_id)
        current = await session.get(Recording, item.id, populate_existing=True)
        if (
            current is None
            or current.deleted_at is not None
            or (current.place_lat, current.place_lon) != (item.lat, item.lon)
            or current.place_name != item.name
            or current.place_origin != item.origin
        ):
            return False
        current.place_name = name
        bump_server_seq(current)
        return True


async def rename_automatic(
    sessionmaker: async_sessionmaker[AsyncSession],
    maps: _Namer,
    client: httpx2.AsyncClient,
    *,
    timeout: float,  # noqa: ASYNC109
    per_second: float,
    dry_run: bool,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> RenameCounts:
    """Re-name device-fix recordings at `per_second` lookups a second, one recording at a time.

    A Maps outage or rate limit backs off and moves on to the next recording, so one bad stretch
    never aborts the run.

    Returns:
        RenameCounts: How many recordings were renamed, left alone, skipped, and failed.
    """
    counts = RenameCounts()
    for item in await _candidates(sessionmaker):
        try:
            name = await _lookup(maps, client, item, timeout=timeout, sleep=sleep)
        except MapsError:
            counts.failed += 1
        else:
            if not name:
                counts.skipped += 1
            elif name == item.name:
                counts.unchanged += 1
            elif dry_run or await _write(sessionmaker, item, name):
                counts.renamed += 1
            else:
                counts.skipped += 1
        await sleep(1 / per_second)
    return counts


def build_parser() -> argparse.ArgumentParser:
    """The `rename-automatic` subcommand."""
    parser = argparse.ArgumentParser(prog="crosstune.ops.places", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    rename = commands.add_parser("rename-automatic", help="re-name recordings the server named")
    rename.add_argument(
        "--per-second", type=float, default=DEFAULT_PER_SECOND, help="lookups a second (default 2)"
    )
    rename.add_argument("--dry-run", action="store_true", help="look up and count, write nothing")
    rename.add_argument("--yes", action="store_true", help="allow writing to production")
    rename.add_argument("--e2e", action="store_true", help="use the e2e database")
    return parser


async def run(settings, args: argparse.Namespace) -> None:  # noqa: ANN001
    """Check the target, then rename and print the counts."""
    # A dry run only reads, so production needs no --yes for it.
    check_target(settings, yes=args.yes or args.dry_run, e2e=args.e2e)
    if args.per_second <= 0:
        msg = "--per-second must be above zero"
        raise BillingCommandError(msg)
    maps = configured_maps(settings)
    if maps is None:
        msg = "Apple Maps is not configured: set the CROSSTUNE_APPLE_MAPS_* settings"
        raise BillingCommandError(msg)
    engine = make_engine(settings.database_url)
    client = public_only_client(settings.link_resolve_timeout_seconds)
    try:
        counts = await rename_automatic(
            make_sessionmaker(engine),
            maps,
            client,
            timeout=settings.link_resolve_timeout_seconds,
            per_second=args.per_second,
            dry_run=args.dry_run,
        )
    finally:
        await client.aclose()
        await engine.dispose()
    verb = "would rename" if args.dry_run else "renamed"
    print(
        f"{verb} {counts.renamed}, unchanged {counts.unchanged}, "
        f"skipped {counts.skipped}, failed {counts.failed}"
    )


def main(argv: list[str] | None = None) -> int:
    """Run `rename-automatic` from the command line."""
    args = build_parser().parse_args(argv)
    try:
        asyncio.run(run(load_settings(), args))
    except ValidationError as exc:
        problems = "; ".join(str(error["msg"]) for error in exc.errors())
        print(f"unusable settings: {problems}", file=sys.stderr)
        return 1
    except BillingCommandError as exc:
        print(exc, file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
