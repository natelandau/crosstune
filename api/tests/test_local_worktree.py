"""Each worktree's own database and bucket: names, the .env rewrite, and the prune guard."""

from __future__ import annotations

import argparse
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING

import pytest

from crosstune.config import Settings
from crosstune.ops import local_storage, local_worktree
from crosstune.ops.local_worktree import Server, names_for, slug, stale
from tests.conftest import POSTGRES_ADMIN_URL

if TYPE_CHECKING:
    from collections.abc import AsyncIterator, Callable

    import asyncpg
    from types_boto3_s3 import S3Client

pytestmark = pytest.mark.anyio

MAIN = Path("/repo/crosstune")


@pytest.mark.parametrize(
    ("key", "expected"),
    [
        ("worktree-db", "worktree_db"),
        ("feat/Link-Search", "feat_link_search"),
        ("--odd..name--", "odd_name"),
    ],
)
def test_slug_keeps_letters_and_digits_joined_by_underscores(key: str, expected: str) -> None:
    assert slug(key) == expected


def test_a_long_slug_fits_postgres_and_stays_distinct() -> None:
    first, second = slug("x" * 80 + "-one"), slug("x" * 80 + "-two")
    assert first != second
    assert len(first) == len(second) == 50


def test_a_key_with_no_letters_or_digits_still_gets_a_name() -> None:
    assert len(slug("---")) == 8


def test_names_pair_the_database_with_its_bucket() -> None:
    names = names_for(MAIN / ".worktrees" / "feat" / "x", MAIN)
    assert (names.database, names.bucket) == ("crosstune_wt_feat_x", "crosstune-wt-feat-x")


def test_names_fit_both_limits_and_satisfy_the_settings_guard() -> None:
    names = names_for(MAIN / ".worktrees" / ("long-branch-" * 10), MAIN)
    assert len(names.database) <= 63
    assert len(names.bucket) <= 63
    Settings(
        database_url=f"postgresql+asyncpg://u:p@localhost:5432/{names.database}",
        storage_bucket=names.bucket,
        storage_access_key_id="key",
        storage_secret_access_key="secret",  # gitleaks:allow -- fixture, not a credential
        local_storage_endpoint_url="http://localhost:9000",
    )


def test_a_worktree_outside_worktrees_is_named_from_its_whole_path() -> None:
    assert names_for(Path("/elsewhere/feat"), MAIN).database == "crosstune_wt_elsewhere_feat"


def test_stale_picks_only_owned_names_without_a_worktree() -> None:
    present = ["crosstune", "crosstune_e2e", "crosstune_wt_gone", "crosstune_wt_here"]
    assert stale(present, {"crosstune_wt_here"}, "crosstune_wt_") == ["crosstune_wt_gone"]


def test_rewrite_env_replaces_values_in_place_and_keeps_the_rest(tmp_path: Path) -> None:
    env_file = tmp_path / "env"
    env_file.write_text(
        "# comment\nCROSSTUNE_DATABASE_URL=old\n# CROSSTUNE_STORAGE_BUCKET=x\nOTHER=1\n"
    )
    local_worktree.rewrite_env(
        env_file, {"CROSSTUNE_DATABASE_URL": "new", "CROSSTUNE_STORAGE_BUCKET": "b"}
    )
    assert env_file.read_text() == (
        "# comment\nCROSSTUNE_DATABASE_URL=new\n# CROSSTUNE_STORAGE_BUCKET=x\nOTHER=1\n"
        "CROSSTUNE_STORAGE_BUCKET=b\n"
    )


def test_with_database_keeps_the_server_and_options() -> None:
    url = "postgresql+asyncpg://u:p@localhost:5432/crosstune?ssl=disable"
    assert (
        local_worktree.with_database(url, "crosstune_wt_x")
        == "postgresql+asyncpg://u:p@localhost:5432/crosstune_wt_x?ssl=disable"
    )


@pytest.mark.parametrize("name", ["crosstune-local", "crosstune-e2e", "crosstune-wt-feat"])
def test_storage_commands_accept_local_and_worktree_buckets(name: str) -> None:
    assert local_storage._owned_bucket(name) == name


def test_storage_commands_refuse_any_other_bucket() -> None:
    with pytest.raises(argparse.ArgumentTypeError):
        local_storage._owned_bucket("crosstune-recordings")


@dataclass
class Scratch:
    """An admin connection, and a prefix no real worktree database can share."""

    server: Server
    conn: asyncpg.Connection
    prefix: str

    def name(self) -> str:
        return f"{self.prefix}{uuid.uuid4().hex[:8]}"


@pytest.fixture
async def scratch() -> AsyncIterator[Scratch]:
    """Work under a per-test prefix, since the server also holds the developer's worktree databases."""
    server = Server(POSTGRES_ADMIN_URL)
    conn = await server.connect()
    scratch = Scratch(
        server=server, conn=conn, prefix=f"crosstune_wt_zztest_{uuid.uuid4().hex[:8]}_"
    )
    yield scratch
    for name in await Server.worktree_databases(conn, scratch.prefix):
        await Server.drop(conn, name)
    await conn.close()


async def test_create_list_and_drop_worktree_databases(scratch: Scratch) -> None:
    name = scratch.name()
    await Server.create(scratch.conn, name)
    assert await Server.exists(scratch.conn, name)
    assert name in await Server.worktree_databases(scratch.conn)
    assert "postgres" not in await Server.worktree_databases(scratch.conn)
    await Server.drop(scratch.conn, name)
    assert not await Server.exists(scratch.conn, name)


async def test_prune_drops_only_databases_without_a_worktree(scratch: Scratch) -> None:
    keep, gone = scratch.name(), scratch.name()
    for name in (keep, gone):
        await Server.create(scratch.conn, name)
    await local_worktree._prune_databases(scratch.server, {keep}, scratch.prefix)
    assert await Server.exists(scratch.conn, keep)
    assert not await Server.exists(scratch.conn, gone)


async def test_every_drop_refuses_a_database_a_worktree_does_not_own(scratch: Scratch) -> None:
    with pytest.raises(SystemExit):
        await Server.drop(scratch.conn, "postgres")
    assert await Server.exists(scratch.conn, "postgres")


def test_copy_bucket_copies_every_object(
    rustfs: S3Client, make_rustfs_bucket: Callable[[str], str]
) -> None:
    source, target = (
        make_rustfs_bucket("crosstune-test-src"),
        make_rustfs_bucket("crosstune-test-dst"),
    )
    for key in ("u/r/playback.m4a", "u/scans/p/page.jpg"):
        rustfs.put_object(Bucket=source, Key=key, Body=key.encode())
    assert local_storage.copy_bucket(rustfs, source=source, target=target) == 2
    copied = rustfs.get_object(Bucket=target, Key="u/scans/p/page.jpg")["Body"].read()
    assert copied == b"u/scans/p/page.jpg"


def test_delete_bucket_removes_a_bucket_that_holds_objects(rustfs: S3Client) -> None:
    bucket = f"crosstune-test-{uuid.uuid4().hex[:12]}"
    local_storage.ensure_bucket(rustfs, bucket)
    rustfs.put_object(Bucket=bucket, Key="u/r/a", Body=b"x")
    local_storage.delete_bucket(rustfs, bucket)
    assert not local_worktree.bucket_exists(rustfs, bucket)


@pytest.mark.parametrize("bucket", ["crosstune-e2e", "crosstune-wt-feat"])
def test_storage_commands_default_to_the_configured_bucket_settings_would_refuse(
    bucket: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """CI's e2e job names crosstune-e2e beside the default database, a pair Settings refuses."""
    monkeypatch.setenv("CROSSTUNE_STORAGE_BUCKET", bucket)
    assert local_storage._default_bucket() == bucket


def test_storage_commands_default_to_the_local_bucket_for_any_other_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("CROSSTUNE_STORAGE_BUCKET", "crosstune-recordings")
    assert local_storage._default_bucket() == local_storage.LOCAL_BUCKET
