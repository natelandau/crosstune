"""Migrations produce the expected schema."""

import anyio
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio


async def test_users_table_exists(session: AsyncSession) -> None:
    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'users'")
    )
    columns = {row[0] for row in result}
    assert {"id", "clerk_user_id", "email", "created_at", "updated_at"} <= columns


async def test_sync_sequence_exists(session: AsyncSession) -> None:
    result = await session.execute(text("select nextval('sync_seq')"))
    assert result.scalar_one() >= 1


async def test_catalog_tables_exist(session: AsyncSession) -> None:
    result = await session.execute(
        text("select table_name from information_schema.tables where table_schema = 'public'")
    )
    tables = {row[0] for row in result}
    assert {"songs", "user_songs", "recording_links", "lists", "list_items"} <= tables


async def test_time_signature_check_constraint_rejects_unknown_value(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into songs (id, owner_user_id, title, time_signature, is_crooked, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', "
                "'Angeline the Baker', '7/8', false, now(), now())"
            )
        )


async def test_server_seq_is_assigned_on_insert(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into songs (id, owner_user_id, title, is_crooked, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', "
            "'Angeline the Baker', false, now(), now())"
        )
    )
    result = await session.execute(text("select server_seq from songs"))
    assert result.scalar_one() >= 1


async def test_songs_carry_one_tuning_column_per_instrument(session: AsyncSession) -> None:
    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'songs'")
    )
    columns = {row[0] for row in result}
    assert {"violin_tuning", "banjo_tuning"} <= columns
    assert "tuning" not in columns


async def test_user_settings_table_holds_one_row_per_user(session: AsyncSession) -> None:
    result = await session.execute(
        text(
            "select column_name from information_schema.columns where table_name = 'user_settings'"
        )
    )
    columns = {row[0] for row in result}
    assert {
        "id",
        "user_id",
        "instruments",
        "created_at",
        "updated_at",
        "deleted_at",
        "server_seq",
    } <= columns
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into user_settings (id, user_id, instruments, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000003', "
            "'018f0000-0000-7000-8000-000000000001', '{violin}', now(), now())"
        )
    )
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into user_settings (id, user_id, instruments, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000004', "
                "'018f0000-0000-7000-8000-000000000001', '{banjo}', now(), now())"
            )
        )


async def test_downgrade_to_0002_and_back_restores_head_shape(
    session: AsyncSession, database_url: str
) -> None:
    """A downgrade must be reversible: it should undo exactly what its upgrade added."""
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        # env.py drives migrations through asyncio.run(); a worker thread keeps that
        # from colliding with the loop this test itself is already running on.
        await anyio.to_thread.run_sync(command.downgrade, config, "0002")
        result = await session.execute(
            text("select column_name from information_schema.columns where table_name = 'songs'")
        )
        columns = {row[0] for row in result}
        assert "tuning" in columns
        assert not {"violin_tuning", "banjo_tuning"} & columns

        result = await session.execute(
            text("select table_name from information_schema.tables where table_schema = 'public'")
        )
        assert "user_settings" not in {row[0] for row in result}
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'songs'")
    )
    columns = {row[0] for row in result}
    assert {"violin_tuning", "banjo_tuning"} <= columns
    assert "tuning" not in columns

    result = await session.execute(
        text("select table_name from information_schema.tables where table_schema = 'public'")
    )
    assert "user_settings" in {row[0] for row in result}
