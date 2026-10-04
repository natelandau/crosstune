"""Give each git worktree its own database and bucket on the servers compose.yml starts.

Branches in separate worktrees write migrations at the same time, so one shared database
ends up at a revision another branch cannot find. Each worktree works on a copy of the
main checkout's database and bucket instead, and `prune` removes the copies of worktrees
that no longer exist.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING
from urllib.parse import urlsplit, urlunsplit

import asyncpg
from botocore.exceptions import ClientError
from dotenv import dotenv_values

from crosstune.config import (
    LOCAL_BUCKET,
    WORKTREE_BUCKET_PREFIX,
    WORKTREE_DATABASE_PREFIX,
    Settings,
    worktree_bucket,
)
from crosstune.ops import local_storage

if TYPE_CHECKING:
    from types_boto3_s3 import S3Client

# Postgres truncates names at 63 bytes. The bucket prefix is as long as the database
# prefix, so one slug fits both, and S3's 63-character limit with it.
_MAX_SLUG = 63 - len(WORKTREE_DATABASE_PREFIX)
_DEFAULT_DATABASE_URL: str = Settings.model_fields["database_url"].default


@dataclass(frozen=True)
class WorktreeNames:
    """The database and bucket one worktree owns."""

    database: str
    bucket: str


def slug(key: str) -> str:
    """Turn a worktree's path into a name Postgres and S3 both accept.

    A key too long for the limit keeps a readable head plus a hash of the whole key, so two
    long branch names that share a head still get different names.

    Args:
        key: The worktree's path below `.worktrees/`, or its absolute path when outside it.

    Returns:
        str: Lowercase letters and digits joined by underscores, at most 50 characters.
    """
    joined = "_".join(re.findall(r"[a-z0-9]+", key.lower()))
    if joined and len(joined) <= _MAX_SLUG:
        return joined
    digest = hashlib.sha256(key.encode()).hexdigest()[:8]
    head = joined[: _MAX_SLUG - len(digest) - 1].rstrip("_")
    return f"{head}_{digest}" if head else digest


def names_for(worktree: Path, main: Path) -> WorktreeNames:
    """Name the database and bucket of a worktree from where it sits."""
    try:
        key = worktree.relative_to(main / ".worktrees").as_posix()
    except ValueError:
        key = worktree.as_posix()
    database = WORKTREE_DATABASE_PREFIX + slug(key)
    return WorktreeNames(database=database, bucket=worktree_bucket(database))


def stale(present: list[str], keep: set[str], prefix: str) -> list[str]:
    """Pick the names this module made whose worktree is gone, never a name it did not make."""
    return sorted(name for name in present if name.startswith(prefix) and name not in keep)


def checkouts(cwd: Path) -> tuple[Path, list[Path]]:
    """Find the main checkout and every worktree, from git's own record.

    Returns:
        tuple[Path, list[Path]]: The main checkout, then every linked worktree.
    """
    listing = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],  # noqa: S607 -- git from the developer's PATH
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    paths = [
        Path(line.removeprefix("worktree "))
        for line in listing.splitlines()
        if line.startswith("worktree ")
    ]
    return paths[0], paths[1:]


def toplevel(cwd: Path) -> Path:
    """The root of the checkout that holds cwd."""
    out = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"],  # noqa: S607 -- git from the developer's PATH
        cwd=cwd,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return Path(out.strip())


def env_value(env_file: Path, key: str, default: str) -> str:
    """Read one value from a checkout's api/.env without building Settings, which may refuse it."""
    if not env_file.exists():
        return default
    return dotenv_values(env_file).get(key) or default


def rewrite_env(env_file: Path, values: dict[str, str]) -> None:
    """Set each key in an .env file in place, keeping every other line and comment."""
    lines = env_file.read_text().splitlines() if env_file.exists() else []
    pending = dict(values)
    for index, line in enumerate(lines):
        key = line.split("=", 1)[0].strip()
        if key in pending:
            lines[index] = f"{key}={pending.pop(key)}"
    lines.extend(f"{key}={value}" for key, value in pending.items())
    env_file.write_text("\n".join(lines) + "\n")


def with_database(url: str, database: str) -> str:
    """The same server URL, pointed at another database."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, parts.fragment))


def database_of(url: str) -> str:
    """The database at the end of a connection string."""
    return urlsplit(url).path.lstrip("/")


class Server:
    """The local Postgres server, reached as an administrator through its `postgres` database."""

    def __init__(self, url: str) -> None:
        parts = urlsplit(url)
        self.netloc = parts.netloc
        self.user = parts.username or "postgres"

    async def connect(self) -> asyncpg.Connection:
        """Connect to the server's `postgres` database, or exit with how to start the server."""
        admin_url = urlunsplit(("postgresql", self.netloc, "/postgres", "", ""))
        try:
            return await asyncpg.connect(admin_url)
        except OSError as exc:
            host = self.netloc.rsplit("@", 1)[-1]
            sys.exit(f"no Postgres at {host}: {exc}. Start it with `docker compose up -d`")

    @staticmethod
    async def exists(conn: asyncpg.Connection, name: str) -> bool:
        """Whether the server has a database of that name."""
        return bool(await conn.fetchval("select 1 from pg_database where datname = $1", name))

    @staticmethod
    async def worktree_databases(
        conn: asyncpg.Connection, prefix: str = WORKTREE_DATABASE_PREFIX
    ) -> list[str]:
        """Every database a worktree owns, or only those under a narrower prefix."""
        rows = await conn.fetch(
            "select datname from pg_database where starts_with(datname, $1)", prefix
        )
        return [row["datname"] for row in rows]

    @staticmethod
    async def create(conn: asyncpg.Connection, name: str) -> None:
        """Create an empty worktree database."""
        await conn.execute(f'create database "{_identifier(name)}"')

    @staticmethod
    async def drop(conn: asyncpg.Connection, name: str) -> None:
        """Drop a worktree database, ending any session still on it."""
        await conn.execute(f'drop database if exists "{_identifier(name)}" with (force)')


def _identifier(name: str) -> str:
    # The one guard between these commands and a database someone fills by hand.
    if not name.startswith(WORKTREE_DATABASE_PREFIX):
        sys.exit(
            f"refusing to act on {name}: these commands own {WORKTREE_DATABASE_PREFIX}* databases only"
        )
    # A quoted identifier ends at its first quote, so every quote in the name is doubled.
    return name.replace('"', '""')


def clone_database(compose_file: Path, user: str, source: str, target: str) -> None:
    """Copy one database into another inside the Postgres container.

    pg_dump reads a consistent snapshot while other sessions stay connected, which
    `create database ... template` refuses, so the main checkout's `just dev` may keep running.

    Raises:
        RuntimeError: When the dump or the restore fails.
    """
    exec_postgres = ["docker", "compose", "-f", str(compose_file), "exec", "-T", "postgres"]
    with subprocess.Popen(  # noqa: S603 -- an argv list, never a shell
        [*exec_postgres, "pg_dump", "-U", user, "--format=custom", source],
        stdout=subprocess.PIPE,
    ) as dump:
        restore = subprocess.run(  # noqa: S603 -- an argv list, never a shell
            [
                *exec_postgres,
                "pg_restore",
                "-U",
                user,
                "--no-owner",
                "--no-privileges",
                "--exit-on-error",
                "-d",
                target,
            ],
            stdin=dump.stdout,
            check=False,
        )
        if dump.stdout:
            dump.stdout.close()
    if dump.returncode or restore.returncode:
        msg = f"copying {source} into {target} failed: pg_dump exited {dump.returncode}, pg_restore {restore.returncode}"
        raise RuntimeError(msg)


def bucket_exists(client: S3Client, bucket: str) -> bool:
    """Whether RustFS has a bucket of that name."""
    try:
        client.head_bucket(Bucket=bucket)
    except ClientError:
        return False
    return True


async def _provision_database(
    server: Server, compose_file: Path, source: str, target: str, *, reset: bool
) -> None:
    conn = await server.connect()
    try:
        if reset:
            await Server.drop(conn, target)
            print(f"dropped {target}")
        if await Server.exists(conn, target):
            print(f"{target} is already there")
            return
        await Server.create(conn, target)
        if not await Server.exists(conn, source):
            print(f"created {target} empty, since {source} is not there")
            return
        try:
            clone_database(compose_file, server.user, source, target)
        except BaseException:
            # A half-restored database would pass for a finished one on the next run.
            await Server.drop(conn, target)
            raise
        print(f"created {target} as a copy of {source}")
    finally:
        await conn.close()


def _provision_bucket(client: S3Client, source: str, target: str, *, reset: bool) -> None:
    if reset and bucket_exists(client, target):
        local_storage.delete_bucket(client, target)
        print(f"deleted {target}")
    if bucket_exists(client, target):
        local_storage.ensure_bucket(client, target)
        print(f"{target} is already there")
        return
    local_storage.ensure_bucket(client, target)
    if not bucket_exists(client, source):
        print(f"created {target} empty, since {source} is not there")
        return
    try:
        copied = local_storage.copy_bucket(client, source=source, target=target)
    except BaseException:
        # A half-copied bucket would pass for a finished one on the next run.
        local_storage.delete_bucket(client, target)
        raise
    print(f"created {target} with {copied} objects copied from {source}")


def provision(cwd: Path, *, reset: bool) -> WorktreeNames:
    """Give the worktree that holds cwd its own database and bucket, and point its api/.env at them.

    Both start as a snapshot of the main checkout's. Running it again keeps what is there,
    and reset replaces both with a fresh snapshot.

    Returns:
        WorktreeNames: The worktree's database and bucket.
    """
    main, _ = checkouts(cwd)
    here = toplevel(cwd)
    if here == main:
        sys.exit("this is the main checkout, which keeps its own database; run this in a worktree")
    names = names_for(here, main)
    env_file = here / "api" / ".env"
    url = env_value(env_file, "CROSSTUNE_DATABASE_URL", _DEFAULT_DATABASE_URL)
    source = database_of(
        env_value(main / "api" / ".env", "CROSSTUNE_DATABASE_URL", _DEFAULT_DATABASE_URL)
    )
    asyncio.run(
        _provision_database(Server(url), here / "compose.yml", source, names.database, reset=reset)
    )
    client = local_storage.client()
    local_storage.wait_until_ready(client)
    _provision_bucket(client, LOCAL_BUCKET, names.bucket, reset=reset)
    rewrite_env(
        env_file,
        {
            "CROSSTUNE_DATABASE_URL": with_database(url, names.database),
            "CROSSTUNE_STORAGE_BUCKET": names.bucket,
        },
    )
    print(f"api/.env now uses {names.database} and {names.bucket}")
    return names


async def _prune_databases(
    server: Server, keep: set[str], prefix: str = WORKTREE_DATABASE_PREFIX
) -> None:
    conn = await server.connect()
    try:
        for name in stale(await Server.worktree_databases(conn, prefix), keep, prefix):
            await Server.drop(conn, name)
            print(f"dropped {name}")
    finally:
        await conn.close()


def prune(cwd: Path) -> None:
    """Drop the database and delete the bucket of every worktree that no longer exists."""
    main, worktrees = checkouts(cwd)
    owned = [names_for(path, main) for path in worktrees]
    url = env_value(toplevel(cwd) / "api" / ".env", "CROSSTUNE_DATABASE_URL", _DEFAULT_DATABASE_URL)
    asyncio.run(_prune_databases(Server(url), {names.database for names in owned}))
    client = local_storage.client()
    local_storage.wait_until_ready(client)
    present = [bucket["Name"] for bucket in client.list_buckets().get("Buckets", [])]
    for bucket in stale(present, {names.bucket for names in owned}, WORKTREE_BUCKET_PREFIX):
        local_storage.delete_bucket(client, bucket)
        print(f"deleted {bucket}")


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="just api::worktree-db", description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    provide = commands.add_parser(
        "provision", help="give this worktree its own database and bucket"
    )
    provide.add_argument(
        "--reset", action="store_true", help="replace both with a fresh copy of main's"
    )
    commands.add_parser(
        "prune", help="remove the database and bucket of every worktree that is gone"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    """Provision this worktree or prune the leftovers of removed ones."""
    args = _parser().parse_args(argv)
    if args.command == "provision":
        provision(Path.cwd(), reset=args.reset)
    else:
        prune(Path.cwd())
    return 0


if __name__ == "__main__":
    sys.exit(main())
