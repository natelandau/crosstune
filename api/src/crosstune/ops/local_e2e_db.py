"""Create, recreate, or drop the end-to-end suite's database on the server compose.yml starts.

The suite owns one database whose name ends in `_e2e`, beside the development database a
person fills by hand. Every command here refuses any other name.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from typing import Literal, get_args

from crosstune.ops.local_worktree import Server, database_of

E2E_SUFFIX = "_e2e"

Mode = Literal["keep", "recreate", "drop"]


def owned(name: str) -> str:
    """Quote an end-to-end database name for SQL, or exit when the suite does not own it.

    Args:
        name: The database the command is about to create or drop.

    Returns:
        str: The name with every double quote doubled, ready to sit inside `"..."`.
    """
    # The one guard between a reset and a developer's own data.
    if not name.endswith(E2E_SUFFIX):
        sys.exit(
            f"refusing to act on {name}: these recipes own a {E2E_SUFFIX} database and nothing else"
        )
    # A quoted identifier ends at its first quote, so every quote in the name is doubled.
    return name.replace('"', '""')


async def prepare(url: str, mode: Mode) -> None:
    """Bring the end-to-end database to the state a run needs before or after it.

    Args:
        url: The end-to-end database's connection string.
        mode: `keep` creates it when absent, `recreate` drops and creates it, and `drop`
            leaves no database behind.
    """
    name = database_of(url)
    identifier = owned(name)
    conn = await Server(url).connect()
    try:
        if mode in {"recreate", "drop"}:
            existed = await Server.exists(conn, name)
            # Postgres refuses to drop a database that still has sessions on it, and a drop
            # follows a run whose API may still hold its pool open.
            await conn.execute(f'drop database if exists "{identifier}" with (force)')
            print(f"dropped {name}" if existed else f"{name} was not there")
        if mode == "drop":
            return
        if await Server.exists(conn, name):
            print(f"{name} is already there")
        else:
            await conn.execute(f'create database "{identifier}"')
            print(f"created {name}")
    finally:
        await conn.close()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="just api::e2e-db", description=__doc__)
    parser.add_argument("mode", choices=get_args(Mode))
    parser.add_argument("url", help="the end-to-end database's connection string")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Create, recreate, or drop the end-to-end database."""
    args = _parser().parse_args(argv)
    asyncio.run(prepare(url=args.url, mode=args.mode))
    return 0


if __name__ == "__main__":
    sys.exit(main())
