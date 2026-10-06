"""The end-to-end database commands: keep, recreate, drop, and the name guard."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest

from crosstune.ops.local_e2e_db import owned, prepare
from crosstune.ops.local_worktree import Server, database_of, with_database
from tests.conftest import POSTGRES_ADMIN_URL, TEST_DATABASE_PREFIX, _run_pid

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

    import asyncpg

pytestmark = pytest.mark.anyio


@pytest.fixture
async def admin() -> AsyncIterator[asyncpg.Connection]:
    conn = await Server(POSTGRES_ADMIN_URL).connect()
    yield conn
    await conn.close()


@pytest.fixture
async def e2e_url(admin: asyncpg.Connection) -> AsyncIterator[str]:
    """Name a per-test database, since the server also holds the developer's real e2e database.

    The run's pid follows the test prefix, so the session sweep drops it only once this run
    is gone, even when a crash skipped the teardown.
    """
    name = f"{TEST_DATABASE_PREFIX}{_run_pid()}_{uuid.uuid4().hex[:8]}_e2e"
    yield with_database(POSTGRES_ADMIN_URL, name)
    await admin.execute(f'drop database if exists "{name}" with (force)')


def test_every_command_refuses_a_database_the_suite_does_not_own() -> None:
    with pytest.raises(SystemExit):
        owned("crosstune")


def test_a_quote_in_the_name_is_doubled() -> None:
    assert owned('a"b_e2e') == 'a""b_e2e'


async def test_keep_creates_the_database_once(
    admin: asyncpg.Connection, e2e_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    await prepare(url=e2e_url, mode="keep")
    await prepare(url=e2e_url, mode="keep")
    name = database_of(e2e_url)
    assert await Server.exists(admin, name)
    assert capsys.readouterr().out.splitlines() == [f"created {name}", f"{name} is already there"]


async def test_recreate_replaces_the_database(admin: asyncpg.Connection, e2e_url: str) -> None:
    oid_of = "select oid from pg_database where datname = $1"
    await prepare(url=e2e_url, mode="keep")
    before = await admin.fetchval(oid_of, database_of(e2e_url))
    await prepare(url=e2e_url, mode="recreate")
    after = await admin.fetchval(oid_of, database_of(e2e_url))
    assert after is not None
    assert after != before


async def test_drop_leaves_no_database_and_tolerates_one_already_gone(
    admin: asyncpg.Connection, e2e_url: str, capsys: pytest.CaptureFixture[str]
) -> None:
    name = database_of(e2e_url)
    await prepare(url=e2e_url, mode="keep")
    await prepare(url=e2e_url, mode="drop")
    await prepare(url=e2e_url, mode="drop")
    assert not await Server.exists(admin, name)
    assert capsys.readouterr().out.splitlines()[1:] == [f"dropped {name}", f"{name} was not there"]
