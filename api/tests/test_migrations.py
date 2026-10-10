"""Migrations produce the expected schema."""

import importlib.util
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

import anyio
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import UniqueConstraint, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from crosstune.db.locks import advisory_lock_key
from crosstune.models import UploadSlot
from crosstune.vocabulary import PlayContext

pytestmark = pytest.mark.anyio

STAMPED = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)


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
    assert {"tunes", "user_tunes", "recording_links", "lists", "list_items"} <= tables


async def test_modes_check_accepts_modal(session: AsyncSession) -> None:
    await _seed_user(session)
    await session.execute(
        text(
            "insert into tunes (id, owner_user_id, title, modes, is_crooked, created_at, "
            "updated_at) values ('018f0000-0000-7000-8000-000000000002', "
            "'018f0000-0000-7000-8000-000000000001', 'Cluck Old Hen', '{modal}', false, "
            "now(), now())"
        )
    )
    stored = await session.execute(text("select modes from tunes"))
    assert stored.scalar_one() == ["modal"]


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
                "insert into tunes (id, owner_user_id, title, time_signature, is_crooked, created_at, updated_at) "
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
            "insert into tunes (id, owner_user_id, title, is_crooked, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', "
            "'Angeline the Baker', false, now(), now())"
        )
    )
    result = await session.execute(text("select server_seq from tunes"))
    assert result.scalar_one() >= 1


async def test_tunes_carry_one_tunings_map(session: AsyncSession) -> None:
    result = await session.execute(
        text(
            "select column_name, data_type from information_schema.columns "
            "where table_name = 'tunes'"
        )
    )
    columns = dict(result.tuples().all())
    assert columns["tunings"] == "jsonb"
    assert "violin_tuning" not in columns
    assert "banjo_tuning" not in columns


async def test_tunings_must_be_an_object(session: AsyncSession) -> None:
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into tunes (id, title, alternate_titles, tunings, is_crooked, "
                "created_at, updated_at) values "
                "(gen_random_uuid(), 'x', '{}', '[]'::jsonb, false, now(), now())"
            )
        )


async def test_0012_moves_tunings_into_the_map_and_renames_banjo(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    settings = "018f0000-0000-7000-8000-000000000011"
    other_user = "018f0000-0000-7000-8000-000000000002"
    other_settings = "018f0000-0000-7000-8000-000000000012"
    both = "018f0000-0000-7000-8000-000000000021"
    none = "018f0000-0000-7000-8000-000000000022"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0011")
        async with engine.begin() as conn:
            for user_id, clerk in ((user, "user_a"), (other_user, "user_b")):
                await conn.execute(
                    text(
                        "insert into users (id, clerk_user_id, created_at, updated_at) "
                        "values (:id, :clerk, now(), now())"
                    ),
                    {"id": user_id, "clerk": clerk},
                )
            for settings_id, user_id, instruments in (
                (settings, user, ["violin", "banjo"]),
                (other_settings, other_user, ["violin"]),
            ):
                await conn.execute(
                    text(
                        "insert into user_settings "
                        "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                        "values (:id, :user, :instruments, 'standard', now(), :stamped)"
                    ),
                    {
                        "id": settings_id,
                        "user": user_id,
                        "instruments": instruments,
                        "stamped": STAMPED,
                    },
                )
            for tune_id, violin, banjo in (
                (both, "Cross A (AEAE)", "Double C (gCGCD)"),
                (none, None, None),
            ):
                await conn.execute(
                    text(
                        "insert into tunes (id, owner_user_id, title, alternate_titles, "
                        "violin_tuning, banjo_tuning, is_crooked, created_at, updated_at) "
                        "values (:id, :user, 't', '{}', :violin, :banjo, false, now(), now())"
                    ),
                    {"id": tune_id, "user": user, "violin": violin, "banjo": banjo},
                )
            before = dict(
                (await conn.execute(text("select id::text, server_seq from user_settings")))
                .tuples()
                .all()
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        tunings = dict(
            (await conn.execute(text("select id::text, tunings from tunes"))).tuples().all()
        )
        rows = {
            row.id: row
            for row in await conn.execute(
                text(
                    "select id::text as id, instruments, server_seq, updated_at from user_settings"
                )
            )
        }
    assert tunings[both] == {
        "violin": {"tuning": "Cross A (AEAE)"},
        "five_string_banjo": {"tuning": "Double C (gCGCD)"},
    }
    assert tunings[none] == {}
    assert rows[settings].instruments == ["violin", "five_string_banjo"]
    assert rows[settings].server_seq > before[settings]
    # A queued offline edit stamped before the migration must still win last-write-wins.
    assert rows[settings].updated_at == STAMPED


async def test_downgrade_to_0011_restores_the_columns_and_strips_new_instruments(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    tune = "018f0000-0000-7000-8000-000000000021"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into user_settings "
                "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                "values (gen_random_uuid(), :user, "
                "array['guitar', 'five_string_banjo']::varchar[], 'standard', now(), :stamped)"
            ),
            {"user": user, "stamped": STAMPED},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, alternate_titles, tunings, "
                "is_crooked, created_at, updated_at) values (:id, :user, 't', '{}', "
                ":tunings ::jsonb, false, now(), now())"
            ),
            {
                "id": tune,
                "user": user,
                "tunings": (
                    '{"violin": {"tuning": "AEAE"}, '
                    '"five_string_banjo": {"tuning": "gDGBD", "capo": 2}, '
                    '"guitar": {"tuning": "DADGAD"}}'
                ),
            },
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0011")
        async with engine.connect() as conn:
            row = (await conn.execute(text("select violin_tuning, banjo_tuning from tunes"))).one()
            instruments, updated_at = (
                await conn.execute(text("select instruments, updated_at from user_settings"))
            ).one()
        assert tuple(row) == ("AEAE", "gDGBD")
        assert instruments == ["banjo"]
        assert updated_at == STAMPED
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_0014_renames_a_leftover_banjo_and_merges_a_repeat(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    renamed = "018f0000-0000-7000-8000-000000000011"
    untouched = "018f0000-0000-7000-8000-000000000012"
    seeded = {
        renamed: (
            "018f0000-0000-7000-8000-000000000001",
            "user_a",
            ["banjo", "violin", "five_string_banjo"],
        ),
        untouched: ("018f0000-0000-7000-8000-000000000002", "user_b", ["violin"]),
    }
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0013")
        async with engine.begin() as conn:
            for settings_id, (user_id, clerk, instruments) in seeded.items():
                await conn.execute(
                    text(
                        "insert into users (id, clerk_user_id, created_at, updated_at) "
                        "values (:id, :clerk, now(), now())"
                    ),
                    {"id": user_id, "clerk": clerk},
                )
                await conn.execute(
                    text(
                        "insert into user_settings "
                        "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                        "values (:id, :user, :instruments, 'standard', now(), :stamped)"
                    ),
                    {
                        "id": settings_id,
                        "user": user_id,
                        "instruments": instruments,
                        "stamped": STAMPED,
                    },
                )
            before = dict(
                (await conn.execute(text("select id::text, server_seq from user_settings")))
                .tuples()
                .all()
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text(
                    "select id::text as id, instruments, server_seq, updated_at from user_settings"
                )
            )
        }
    assert rows[renamed].instruments == ["five_string_banjo", "violin"]
    assert rows[renamed].server_seq > before[renamed]
    assert rows[renamed].updated_at == STAMPED
    assert rows[untouched].instruments == ["violin"]


async def _seed_user(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )


async def test_tunes_hold_type_modes_and_composer(session: AsyncSession) -> None:
    await _seed_user(session)
    await session.execute(
        text(
            "insert into tunes (id, owner_user_id, title, tune_type, modes, composer, "
            "time_signature, is_crooked, created_at, updated_at) values "
            "('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', "
            "'Rolling in the Ryegrass', 'Reel', '{major,dorian}', 'Traditional', '3/2', false, "
            "now(), now())"
        )
    )
    row = (await session.execute(text("select tune_type, modes, composer from tunes"))).one()
    assert row == ("Reel", ["major", "dorian"], "Traditional")


async def test_modes_check_rejects_an_unknown_mode(session: AsyncSession) -> None:
    await _seed_user(session)
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into tunes (id, owner_user_id, title, modes, is_crooked, created_at, "
                "updated_at) values ('018f0000-0000-7000-8000-000000000002', "
                "'018f0000-0000-7000-8000-000000000001', 'Sally Ann', '{lydian}', false, "
                "now(), now())"
            )
        )


async def test_modes_check_rejects_a_fifth_mode(session: AsyncSession) -> None:
    await _seed_user(session)
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into tunes (id, owner_user_id, title, modes, is_crooked, created_at, "
                "updated_at) values ('018f0000-0000-7000-8000-000000000002', "
                "'018f0000-0000-7000-8000-000000000001', 'Sally Ann', "
                "'{major,minor,major,minor,major}', false, now(), now())"
            )
        )


async def test_downgrade_to_0012_and_back_restores_the_columns(
    session: AsyncSession, database_url: str
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0012")
        result = await session.execute(
            text("select column_name from information_schema.columns where table_name = 'tunes'")
        )
        assert not {"tune_type", "modes", "composer"} & {row[0] for row in result}
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'tunes'")
    )
    columns = {row[0] for row in result}
    assert {"tune_type", "modes", "composer"} <= columns
    assert not {"feel", "mode"} & columns


async def test_0013_copies_feel_and_mode_into_type_and_modes(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    jig = "018f0000-0000-7000-8000-000000000021"
    plain = "018f0000-0000-7000-8000-000000000022"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0012")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            for tune_id, feel, mode in ((jig, "Jig", "dorian"), (plain, None, None)):
                await conn.execute(
                    text(
                        "insert into tunes (id, owner_user_id, title, alternate_titles, "
                        "feel, mode, is_crooked, created_at, updated_at) values "
                        "(:id, :user, 't', '{}', :feel, :mode, false, now(), now())"
                    ),
                    {"id": tune_id, "user": user, "feel": feel, "mode": mode},
                )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text("select id::text as id, tune_type, modes from tunes")
            )
        }
    assert rows[jig].tune_type == "Jig"
    assert rows[jig].modes == ["dorian"]
    assert rows[plain].tune_type is None
    assert rows[plain].modes == []


async def test_downgrade_to_0012_maps_3_2_to_other_and_leaves_other_signatures_alone(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    slow_air = "018f0000-0000-7000-8000-000000000021"  # 3/2
    jig = "018f0000-0000-7000-8000-000000000022"  # 6/8
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        for tune_id, signature in ((slow_air, "3/2"), (jig, "6/8")):
            await conn.execute(
                text(
                    "insert into tunes (id, owner_user_id, title, alternate_titles, "
                    "time_signature, is_crooked, created_at, updated_at) values "
                    "(:id, :user, 't', '{}', :sig, false, now(), :stamped)"
                ),
                {"id": tune_id, "user": user, "sig": signature, "stamped": STAMPED},
            )
        before = dict(
            (await conn.execute(text("select id::text, server_seq from tunes"))).tuples().all()
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0012")
        async with engine.connect() as conn:
            rows = {
                row.id: row
                for row in await conn.execute(
                    text("select id::text as id, time_signature, server_seq, updated_at from tunes")
                )
            }
        assert rows[slow_air].time_signature == "other"
        assert rows[slow_air].server_seq > before[slow_air]
        assert rows[slow_air].updated_at == STAMPED
        assert rows[jig].time_signature == "6/8"
        assert rows[jig].server_seq == before[jig]
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


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
        text("select column_name from information_schema.columns where table_name = 'tunes'")
    )
    columns = {row[0] for row in result}
    assert "tunings" in columns
    assert not {"tuning", "violin_tuning", "banjo_tuning"} & columns

    result = await session.execute(
        text("select table_name from information_schema.tables where table_schema = 'public'")
    )
    assert "user_settings" in {row[0] for row in result}


MIGRATION_0005 = (
    Path(__file__).parents[1]
    / "src/crosstune/db/migrations/versions/0005_tidal_and_internet_archive.py"
)


def load_0005():
    spec = importlib.util.spec_from_file_location("migration_0005", MIGRATION_0005)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://tidal.com/track/45670321/u",
            ("tidal", "track:45670321", "https://tidal.com/track/45670321"),
        ),
        (
            "https://listen.tidal.com/album/45670320/track/45670321",
            ("tidal", "track:45670321", "https://tidal.com/track/45670321"),
        ),
        (
            "https://tidal.com/artist/4831953",
            ("tidal", None, "https://tidal.com/artist/4831953"),
        ),
        (
            "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=x",
            ("youtube", "dQw4w9WgXcQ", "https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        ),
        ("https://example.com/tune.mp3", None),
        ("https://archive.org/details/afc1937001_1535B2", None),
    ],
)
def test_0005_redetects_only_tidal_and_youtube_music(url: str, expected) -> None:
    assert load_0005().redetect(url) == expected


async def test_recording_links_accept_the_new_providers(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into tunes (id, owner_user_id, title, is_crooked, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000002', "
            "'018f0000-0000-7000-8000-000000000001', 'Ground Hog', false, now(), now())"
        )
    )
    new_links = {
        "018f0000-0000-7000-8000-000000000011": "tidal",
        "018f0000-0000-7000-8000-000000000012": "internet_archive",
        "018f0000-0000-7000-8000-000000000013": "slippery_hill",
    }
    for link_id, provider in new_links.items():
        await session.execute(
            text(
                "insert into recording_links "
                "(id, tune_id, added_by_user_id, url, provider, created_at, updated_at) "
                "values (:id, '018f0000-0000-7000-8000-000000000002', "
                "'018f0000-0000-7000-8000-000000000001', 'https://x', :provider, now(), now())"
            ),
            {"id": link_id, "provider": provider},
        )
    stored = await session.execute(
        text("select id::text, provider from recording_links where id = any(:ids)"),
        {"ids": list(new_links)},
    )
    assert dict(stored.all()) == new_links


async def test_0005_backfills_tidal_and_youtube_music_links_saved_as_other(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    song = "018f0000-0000-7000-8000-000000000002"
    links = {
        "018f0000-0000-7000-8000-000000000011": "https://tidal.com/track/45670321/u",
        "018f0000-0000-7000-8000-000000000012": "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
        "018f0000-0000-7000-8000-000000000013": "https://example.com/tune.mp3",
    }
    try:
        # env.py drives migrations through asyncio.run(); a worker thread keeps that
        # from colliding with the loop this test itself is already running on.
        await anyio.to_thread.run_sync(command.downgrade, config, "0004")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into songs "
                    "(id, owner_user_id, title, is_crooked, created_at, updated_at) "
                    "values (:id, :owner, 'Ground Hog', false, now(), now())"
                ),
                {"id": song, "owner": user},
            )
            for link_id, url in links.items():
                await conn.execute(
                    text(
                        "insert into recording_links "
                        "(id, song_id, added_by_user_id, url, provider, created_at, updated_at) "
                        "values (:id, :song, :user, :url, 'other', now(), now())"
                    ),
                    {"id": link_id, "song": song, "user": user, "url": url},
                )
            before = dict(
                (await conn.execute(text("select id::text, server_seq from recording_links")))
                .tuples()
                .all()
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text(
                    "select id::text as id, provider, provider_ref, url, server_seq "
                    "from recording_links"
                )
            )
        }
    tidal = rows["018f0000-0000-7000-8000-000000000011"]
    assert (tidal.provider, tidal.provider_ref, tidal.url) == (
        "tidal",
        "track:45670321",
        "https://tidal.com/track/45670321",
    )
    assert tidal.server_seq > before[tidal.id]
    music = rows["018f0000-0000-7000-8000-000000000012"]
    assert (music.provider, music.provider_ref, music.url) == (
        "youtube",
        "dQw4w9WgXcQ",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    )
    assert music.server_seq > before[music.id]
    plain = rows["018f0000-0000-7000-8000-000000000013"]
    assert (plain.provider, plain.server_seq) == ("other", before[plain.id])


async def test_0006_creates_recordings_jobs_and_upload_slots(session: AsyncSession) -> None:
    tables = await session.execute(
        text(
            "select table_name from information_schema.tables "
            "where table_name in ('recordings', 'jobs', 'upload_slots')"
        )
    )
    assert {row[0] for row in tables} == {"recordings", "jobs", "upload_slots"}
    columns = await session.execute(
        text(
            "select column_name, is_nullable, column_default from information_schema.columns "
            "where table_name = 'recordings'"
        )
    )
    by_name = {name: (nullable, default) for name, nullable, default in columns}
    assert by_name["tune_id"][0] == "YES"
    assert by_name["state"][0] == "NO"
    assert "pending_upload" in (by_name["state"][1] or "")
    assert "nextval('sync_seq'" in by_name["server_seq"][1]


async def test_0006_adds_audio_quality_with_a_standard_default(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-00000000000a', 'user_q', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into user_settings (id, user_id, instruments, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-00000000000b', "
            "'018f0000-0000-7000-8000-00000000000a', '{}', now(), now())"
        )
    )
    quality = await session.scalar(
        text(
            "select audio_quality from user_settings "
            "where id = '018f0000-0000-7000-8000-00000000000b'"
        )
    )
    assert quality == "standard"
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "update user_settings set audio_quality = 'lossless' "
                "where id = '018f0000-0000-7000-8000-00000000000b'"
            )
        )


async def test_0006_unfiles_a_recording_when_its_tune_is_deleted(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-00000000001a', 'user_u', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into tunes (id, owner_user_id, title, is_crooked, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-00000000001b', "
            "'018f0000-0000-7000-8000-00000000001a', 'Ducks on the Millpond', false, now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into recordings (id, user_id, tune_id, source, added_at, position, "
            "created_at, updated_at) values ('018f0000-0000-7000-8000-00000000001c', "
            "'018f0000-0000-7000-8000-00000000001a', '018f0000-0000-7000-8000-00000000001b', "
            "'microphone', now(), 0, now(), now())"
        )
    )
    await session.execute(
        text("delete from tunes where id = '018f0000-0000-7000-8000-00000000001b'")
    )
    row = await session.execute(
        text("select tune_id from recordings where id = '018f0000-0000-7000-8000-00000000001c'")
    )
    assert row.scalar_one() is None


async def test_0006_rejects_an_unknown_recording_state(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-00000000000c', 'user_s', now(), now())"
        )
    )
    with pytest.raises(DBAPIError):
        await session.execute(
            text(
                "insert into recordings (id, user_id, source, added_at, position, state, "
                "created_at, updated_at) values ('018f0000-0000-7000-8000-00000000000d', "
                "'018f0000-0000-7000-8000-00000000000c', 'microphone', now(), 0, 'done', "
                "now(), now())"
            )
        )


async def test_downgrade_to_0005_and_back_restores_head_shape(
    session: AsyncSession, database_url: str
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0005")
        gone = await session.execute(
            text(
                "select table_name from information_schema.tables "
                "where table_name in ('recordings', 'jobs', 'upload_slots')"
            )
        )
        assert gone.all() == []
        column = await session.execute(
            text(
                "select column_name from information_schema.columns "
                "where table_name = 'user_settings' and column_name = 'audio_quality'"
            )
        )
        assert column.all() == []
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_tunes_carry_lyrics_and_not_has_lyrics(session: AsyncSession) -> None:
    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'tunes'")
    )
    columns = {row[0] for row in result}
    assert "lyrics" in columns
    assert "has_lyrics" not in columns


async def test_downgrade_to_0006_and_back_restores_head_shape(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000021"
    with_lyrics = "018f0000-0000-7000-8000-000000000022"
    empty_lyrics = "018f0000-0000-7000-8000-000000000023"
    # command.downgrade drives migrations on its own connection, so these rows must be
    # committed here rather than left on the session fixture's rolled-back transaction.
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_lyrics', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, lyrics, is_crooked, "
                "created_at, updated_at) values "
                "(:id, :owner, 'Old Joe Clark', 'true love never was a burden', "
                "false, now(), now())"
            ),
            {"id": with_lyrics, "owner": user},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, lyrics, is_crooked, "
                "created_at, updated_at) values "
                "(:id, :owner, 'Cripple Creek', '', false, now(), now())"
            ),
            {"id": empty_lyrics, "owner": user},
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0006")
        async with engine.connect() as conn:
            result = await conn.execute(
                text("select id::text, has_lyrics from songs where id = any(:ids)"),
                {"ids": [with_lyrics, empty_lyrics]},
            )
            by_id = dict(result.all())
        assert by_id[with_lyrics] is True
        assert by_id[empty_lyrics] is None
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        result = await conn.execute(
            text("select column_name from information_schema.columns where table_name = 'tunes'")
        )
        columns = {row[0] for row in result}
    assert "lyrics" in columns
    assert "has_lyrics" not in columns


async def test_0008_strips_retired_instruments_and_resequences_only_those_rows(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    users = {
        "018f0000-0000-7000-8000-000000000001": ("user_a", ["violin", "guitar", "other"]),
        "018f0000-0000-7000-8000-000000000002": ("user_b", ["banjo"]),
        "018f0000-0000-7000-8000-000000000003": ("user_c", ["accordion"]),
    }
    settings = {
        user: user.replace("7000-8000-0000000000", "7000-8000-0000000001") for user in users
    }
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0007")
        async with engine.begin() as conn:
            for user, (clerk_id, instruments) in users.items():
                await conn.execute(
                    text(
                        "insert into users (id, clerk_user_id, created_at, updated_at) "
                        "values (:id, :clerk_id, now(), now())"
                    ),
                    {"id": user, "clerk_id": clerk_id},
                )
                await conn.execute(
                    text(
                        "insert into user_settings "
                        "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                        "values (:id, :user, :instruments, 'standard', now(), now())"
                    ),
                    {"id": settings[user], "user": user, "instruments": instruments},
                )
            before = dict(
                (await conn.execute(text("select id::text, server_seq from user_settings")))
                .tuples()
                .all()
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text("select id::text as id, instruments, server_seq from user_settings")
            )
        }
    stripped = rows[settings["018f0000-0000-7000-8000-000000000001"]]
    assert stripped.instruments == ["violin"]
    assert stripped.server_seq > before[stripped.id]
    # 0008 leaves this row alone; 0012, later in the chain to head, renames its banjo entry.
    untouched = rows[settings["018f0000-0000-7000-8000-000000000002"]]
    assert untouched.instruments == ["five_string_banjo"]
    assert untouched.server_seq > before[untouched.id]
    emptied = rows[settings["018f0000-0000-7000-8000-000000000003"]]
    assert emptied.instruments == []
    assert emptied.server_seq > before[emptied.id]


REDUNDANT_INDEXES = {
    "ix_songs_owner_user_id",
    "ix_user_songs_user_id",
    "ix_recording_links_added_by_user_id",
    "ix_lists_user_id",
    "ix_list_items_list_id",
    "ix_recordings_user_id",
}


async def _index_names(engine) -> set[str]:
    async with engine.connect() as conn:
        result = await conn.execute(
            text("select indexname from pg_indexes where schemaname = 'public'")
        )
        return {row[0] for row in result}


async def test_0010_drops_indexes_a_composite_index_covers_and_downgrade_restores_them(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    head = await _index_names(engine)
    assert not REDUNDANT_INDEXES & head
    assert {
        "ix_tunes_owner_user_id_server_seq",
        "ix_user_tunes_user_id_server_seq",
        "ix_recording_links_added_by_user_id_server_seq",
        "ix_lists_user_id_server_seq",
        "ix_list_items_list_id_server_seq",
        "ix_recordings_user_id_server_seq",
    } <= head
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0009")
        assert await _index_names(engine) >= REDUNDANT_INDEXES
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    assert await _index_names(engine) == head


async def test_0011_names_every_table_column_constraint_and_index_for_tunes(
    session: AsyncSession,
) -> None:
    result = await session.execute(
        text("select table_name from information_schema.tables where table_schema = 'public'")
    )
    tables = {row[0] for row in result}
    assert {"tunes", "user_tunes"} <= tables
    assert not {"songs", "user_songs"} & tables

    for query in (
        (
            "select table_name || '.' || column_name from information_schema.columns "
            "where table_schema = 'public' and column_name like '%song%'"
        ),
        "select conname from pg_constraint where conname like '%song%'",
        "select indexname from pg_indexes where schemaname = 'public' and indexname like '%song%'",
    ):
        assert (await session.execute(text(query))).all() == [], query


async def test_0011_downgrade_and_back_keeps_every_tune_and_its_references(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000031"
    tune = "018f0000-0000-7000-8000-000000000032"
    user_tune = "018f0000-0000-7000-8000-000000000033"
    list_id = "018f0000-0000-7000-8000-000000000034"
    item = "018f0000-0000-7000-8000-000000000035"
    # command.downgrade drives migrations on its own connection, so these rows must be
    # committed here rather than left on the session fixture's rolled-back transaction.
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_rename', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, is_crooked, created_at, updated_at) "
                "values (:id, :owner, 'Sail Away Ladies', false, now(), now())"
            ),
            {"id": tune, "owner": user},
        )
        await conn.execute(
            text(
                "insert into user_tunes (id, user_id, tune_id, status, created_at, updated_at) "
                "values (:id, :user, :tune, 'known', now(), now())"
            ),
            {"id": user_tune, "user": user, "tune": tune},
        )
        await conn.execute(
            text(
                "insert into lists (id, user_id, name, position, created_at, updated_at) "
                "values (:id, :user, 'Friday', 0, now(), now())"
            ),
            {"id": list_id, "user": user},
        )
        await conn.execute(
            text(
                "insert into list_items (id, list_id, user_tune_id, position, created_at, "
                "updated_at) values (:id, :list, :user_tune, 0, now(), now())"
            ),
            {"id": item, "list": list_id, "user_tune": user_tune},
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0010")
        async with engine.connect() as conn:
            row = (
                await conn.execute(
                    text(
                        "select us.song_id::text, li.user_song_id::text from user_songs us "
                        "join list_items li on li.user_song_id = us.id"
                    )
                )
            ).one()
            # Matches the prefixes/infixes the migration itself renames by, so a stray
            # "tuning" column (violin_tuning, banjo_tuning) cannot false-positive.
            leftover = (
                await conn.execute(
                    text(
                        "select conname from pg_constraint "
                        "where conname ~ '^tunes_' or conname ~ '^user_tunes_' "
                        "or conname ~ '_tune_id' or conname ~ '_user_tune_id' "
                        "union all "
                        "select indexname from pg_indexes where schemaname = 'public' "
                        "and (indexname ~ '^tunes_' or indexname ~ '^user_tunes_' "
                        "or indexname ~ '_tune_id' or indexname ~ '_user_tune_id')"
                    )
                )
            ).all()
            assert leftover == []
        assert tuple(row) == (tune, user_tune)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        row = (
            await conn.execute(
                text(
                    "select ut.tune_id::text, li.user_tune_id::text from user_tunes ut "
                    "join list_items li on li.user_tune_id = ut.id"
                )
            )
        ).one()
    assert tuple(row) == (tune, user_tune)


async def test_tunes_no_longer_carry_feel_or_a_single_mode(session: AsyncSession) -> None:
    result = await session.execute(
        text("select column_name from information_schema.columns where table_name = 'tunes'")
    )
    assert not {"feel", "mode"} & {row[0] for row in result}


async def test_0017_queues_peaks_backfill(engine, database_url: str, truncate_all: None) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    live_ready = "018f0000-0000-7000-8000-000000000021"
    deleted_ready = "018f0000-0000-7000-8000-000000000022"
    failed = "018f0000-0000-7000-8000-000000000023"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0016")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, recorded_at, state, "
                    "created_at, updated_at, deleted_at) values "
                    "(:live_ready, :user, 'microphone', now(), 'ready', now(), now(), null), "
                    "(:deleted_ready, :user, 'microphone', now(), 'ready', now(), now(), now()), "
                    "(:failed, :user, 'microphone', now(), 'failed', now(), now(), null)"
                ),
                {
                    "live_ready": live_ready,
                    "deleted_ready": deleted_ready,
                    "failed": failed,
                    "user": user,
                },
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        jobs = {
            row[0]: row[1:]
            for row in (
                await conn.execute(
                    text(
                        "select recording_id::text, kind, "
                        "locked_until > now() + interval '14 minutes' from jobs"
                    )
                )
            ).tuples()
        }
    # Held past the deploy overlap, so only a runner that knows the kind claims it.
    assert jobs[live_ready] == ("peaks", True)
    assert deleted_ready not in jobs
    assert failed not in jobs


async def test_0017_gives_ready_recordings_their_full_playback_range(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    ready = "018f0000-0000-7000-8000-000000000031"
    pending = "018f0000-0000-7000-8000-000000000032"
    unmeasured = "018f0000-0000-7000-8000-000000000033"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0016")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, recorded_at, state, "
                    "duration_ms, created_at, updated_at) values "
                    "(:ready, :user, 'microphone', now(), 'ready', 2000, now(), now()), "
                    "(:pending, :user, 'microphone', now(), 'pending_upload', null, now(), now()), "
                    "(:unmeasured, :user, 'microphone', now(), 'ready', null, now(), now())"
                ),
                {"ready": ready, "pending": pending, "unmeasured": unmeasured, "user": user},
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row[0]: row[1:]
            for row in (
                await conn.execute(
                    text(
                        "select id::text, source_duration_ms, playback_start_ms, "
                        "playback_end_ms, playback_rev from recordings"
                    )
                )
            ).tuples()
        }
    assert rows[ready][:3] == (2000, 0, 2000)
    assert re.fullmatch(r"[0-9a-f]{8}", rows[ready][3])
    assert rows[pending] == (None, None, None, None)
    # No length means no range to trim within, but the file still plays from its start.
    assert rows[unmeasured][:3] == (None, 0, None)
    assert re.fullmatch(r"[0-9a-f]{8}", rows[unmeasured][3])


async def test_0017_leaves_a_ready_recording_downloadable(
    engine, database_url: str, client, auth_headers
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    ready = "018f0000-0000-7000-8000-000000000041"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0016")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, recorded_at, state, "
                    "duration_ms, playback_key, playback_bytes, created_at, updated_at) values "
                    "(:ready, :user, 'microphone', now(), 'ready', 2000, :key, 10, now(), now())"
                ),
                {"ready": ready, "user": user, "key": f"{user}/{ready}/playback.m4a"},
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    response = await client.get(f"/v1/recordings/{ready}/download", headers=auth_headers("user_a"))
    assert response.status_code == 200
    body = response.json()
    assert re.fullmatch(r"[0-9a-f]{8}", body["playback_rev"])
    assert body["playback_start_ms"] == 0
    # The backfilled peaks job has not run, so there is no waveform yet, only a 409.
    peaks = await client.get(f"/v1/recordings/{ready}/peaks", headers=auth_headers("user_a"))
    assert peaks.status_code == 409


RECORDING_0017_COLUMNS = {
    "trim_start_ms",
    "trim_end_ms",
    "speed_percent",
    "pitch_cents",
    "source_duration_ms",
    "playback_start_ms",
    "playback_end_ms",
    "playback_rev",
    "peaks_key",
    "peaks_rev",
    "peaks_bytes",
}


async def test_downgrade_to_0016_drops_the_new_columns_and_non_transcode_jobs(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    recording = "018f0000-0000-7000-8000-000000000021"
    transcode_job = "018f0000-0000-7000-8000-000000000031"
    peaks_job = "018f0000-0000-7000-8000-000000000032"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into recordings (id, user_id, source, added_at, recorded_at, "
                "recorded_precision, state, created_at, updated_at) values "
                "(:id, :user, 'microphone', now(), now(), 'time', 'ready', now(), now())"
            ),
            {"id": recording, "user": user},
        )
        await conn.execute(
            text(
                "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) "
                "values (:transcode, :recording, :user, 'transcode', 0, now()), "
                "(:peaks, :recording, :user, 'peaks', 0, now())"
            ),
            {
                "transcode": transcode_job,
                "peaks": peaks_job,
                "recording": recording,
                "user": user,
            },
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0016")
        async with engine.connect() as conn:
            recording_columns = {
                row[0]
                for row in await conn.execute(
                    text(
                        "select column_name from information_schema.columns "
                        "where table_name = 'recordings'"
                    )
                )
            }
            job_columns = {
                row[0]
                for row in await conn.execute(
                    text(
                        "select column_name from information_schema.columns "
                        "where table_name = 'jobs'"
                    )
                )
            }
            remaining_jobs = {
                row[0] for row in await conn.execute(text("select id::text from jobs"))
            }
        assert not RECORDING_0017_COLUMNS & recording_columns
        assert "kind" not in job_columns
        assert remaining_jobs == {transcode_job}
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        recording_columns = {
            row[0]
            for row in await conn.execute(
                text(
                    "select column_name from information_schema.columns "
                    "where table_name = 'recordings'"
                )
            )
        }
        job_columns = {
            row[0]
            for row in await conn.execute(
                text("select column_name from information_schema.columns where table_name = 'jobs'")
            )
        }
    assert recording_columns >= RECORDING_0017_COLUMNS
    assert "kind" in job_columns


async def test_downgrade_to_0014_restores_feel_and_mode_from_type_and_first_mode(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    kesh = "018f0000-0000-7000-8000-000000000021"
    plain = "018f0000-0000-7000-8000-000000000022"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, alternate_titles, tune_type, modes, "
                "is_crooked, created_at, updated_at) values "
                "(:kesh, :user, 'The Kesh', '{}', 'Jig', '{dorian,major}', false, now(), now()), "
                "(:plain, :user, 'Sally Ann', '{}', null, '{}', false, now(), now())"
            ),
            {"kesh": kesh, "plain": plain, "user": user},
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0014")
        async with engine.connect() as conn:
            rows = {
                row.id: row
                for row in await conn.execute(text("select id::text as id, feel, mode from tunes"))
            }
        assert (rows[kesh].feel, rows[kesh].mode) == ("Jig", "dorian")
        assert (rows[plain].feel, rows[plain].mode) == (None, None)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_downgrade_to_0017_drops_recording_loops_and_upgrade_restores_them(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    query = text("select to_regclass('public.recording_loops') is not null")
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0017")
        async with engine.connect() as conn:
            assert not (await conn.execute(query)).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        assert (await conn.execute(query)).scalar_one()


async def test_downgrade_to_0018_restores_the_link_label_and_upgrade_drops_it(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    query = text(
        "select count(*) from information_schema.columns "
        "where table_name = 'recording_links' and column_name = 'label'"
    )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0018")
        async with engine.connect() as conn:
            assert (await conn.execute(query)).scalar_one() == 1
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        assert (await conn.execute(query)).scalar_one() == 0


async def test_0020_cuts_overlapping_loops_and_resequences_only_those(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    rec = "018f0000-0000-7000-8000-000000000021"
    loops = {
        "n1": ("018f0000-0000-7000-8000-000000000031", 1000, 9000),
        "n2": ("018f0000-0000-7000-8000-000000000032", 3000, 5000),
        "c1": ("018f0000-0000-7000-8000-000000000033", 10000, 14000),
        "c2": ("018f0000-0000-7000-8000-000000000034", 12000, 16000),
        "i1": ("018f0000-0000-7000-8000-000000000035", 20000, 22000),
        "i2": ("018f0000-0000-7000-8000-000000000036", 20000, 22000),
        "ok": ("018f0000-0000-7000-8000-000000000037", 30000, 31000),
        "t1": ("018f0000-0000-7000-8000-000000000038", 40000, 44000),
        "t2": ("018f0000-0000-7000-8000-000000000039", 41000, 44300),
        "t3": ("018f0000-0000-7000-8000-00000000003a", 44100, 45000),
        "a": ("018f0000-0000-7000-8000-00000000003b", 50000, 54000),
        "b": ("018f0000-0000-7000-8000-00000000003c", 52000, 56000),
        "c": ("018f0000-0000-7000-8000-00000000003d", 53000, 58000),
    }
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0019")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, recorded_at, state, "
                    "created_at, updated_at) values "
                    "(:rec, :user, 'microphone', now(), 'ready', now(), now())"
                ),
                {"rec": rec, "user": user},
            )
            for id_, start_ms, end_ms in loops.values():
                await conn.execute(
                    text(
                        "insert into recording_loops (id, user_id, recording_id, start_ms, "
                        "end_ms, color, created_at, updated_at) values "
                        "(:id, :user, :rec, :start_ms, :end_ms, 0, now(), now())"
                    ),
                    {"id": id_, "user": user, "rec": rec, "start_ms": start_ms, "end_ms": end_ms},
                )
            before = dict(
                (await conn.execute(text("select id::text, server_seq from recording_loops")))
                .tuples()
                .all()
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text(
                    "select id::text as id, start_ms, end_ms, deleted_at is not null as deleted, "
                    "server_seq from recording_loops"
                )
            )
        }

    def state(name: str) -> tuple[int, int, bool]:
        row = rows[loops[name][0]]
        return (row.start_ms, row.end_ms, row.deleted)

    def resequenced(name: str) -> bool:
        id_ = loops[name][0]
        return rows[id_].server_seq > before[id_]

    assert state("n1") == (1000, 9000, False)
    assert state("n2") == (3000, 5000, True)
    assert state("c1") == (10000, 14000, False)
    assert state("c2") == (14000, 16000, False)
    assert state("i1") == (20000, 22000, False)
    assert state("i2") == (20000, 22000, True)
    assert state("ok") == (30000, 31000, False)
    assert state("t1") == (40000, 44000, False)
    assert state("t2") == (41000, 44300, True)
    # The tombstoned t2 leaves the kept end at 44000, so t3 starts clear of it.
    assert state("t3") == (44100, 45000, False)
    assert state("a") == (50000, 54000, False)
    assert state("b") == (54000, 56000, False)
    assert state("c") == (56000, 58000, False)
    assert {name for name in loops if resequenced(name)} == {"n2", "c2", "i2", "t2", "b", "c"}


MIGRATION_0020 = (
    Path(__file__).parents[1] / "src/crosstune/db/migrations/versions/0020_loops_never_overlap.py"
)


@pytest.mark.parametrize(
    "user_id",
    [
        "018f0000-0000-7000-8000-000000000001",
        "018f0000-0000-7000-ffff-ffffffffffff",
        "018f0000-0000-7000-7fff-ffffffffffff",
    ],
)
async def test_0020_locks_each_user_with_the_app_advisory_key(
    session: AsyncSession, user_id: str
) -> None:
    spec = importlib.util.spec_from_file_location("migration_0020", MIGRATION_0020)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    expression = module.LOCK_KEY_SQL.format(column="cast(:user_id as uuid)")

    key = (await session.execute(text(f"select {expression}"), {"user_id": user_id})).scalar_one()

    assert key == advisory_lock_key(uuid.UUID(user_id))


async def test_0021_fills_search_providers_for_existing_rows(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000031"
    settings = "018f0000-0000-7000-8000-000000000032"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0020")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into user_settings "
                    "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                    "values (:id, :user, '{}', 'standard', now(), now())"
                ),
                {"id": settings, "user": user},
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        stored = (
            await conn.execute(text("select search_providers from user_settings"))
        ).scalar_one()
    assert stored == [
        "apple_music",
        "tidal",
        "internet_archive",
        "slippery_hill",
        "youtube",
        "spotify",
        "bandcamp",
        "soundcloud",
    ]


async def test_0022_adds_play_sources_and_play_first(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000031"
    settings = "018f0000-0000-7000-8000-000000000032"
    tune = "018f0000-0000-7000-8000-000000000033"
    pin_a = "018f0000-0000-7000-8000-000000000034"
    pin_b = "018f0000-0000-7000-8000-000000000035"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0021")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into user_settings "
                    "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                    "values (:id, :user, '{}', 'standard', now(), now())"
                ),
                {"id": settings, "user": user},
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.begin() as conn:
        stored = (await conn.execute(text("select play_first from user_settings"))).scalar_one()
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, created_at, updated_at) "
                "values (:id, :user, 'Sally Ann', now(), now())"
            ),
            {"id": tune, "user": user},
        )
    assert stored == "recordings"
    with pytest.raises(IntegrityError):
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into user_tunes (id, user_id, tune_id, status, play_recording_id, "
                    "play_link_id, created_at, updated_at) "
                    "values (:id, :user, :tune, 'known', :a, :b, now(), now())"
                ),
                {"id": pin_a, "user": user, "tune": tune, "a": pin_a, "b": pin_b},
            )


MIGRATION_0023 = (
    Path(__file__).parents[1] / "src/crosstune/db/migrations/versions/0023_slippery_hill.py"
)


def load_0023():
    spec = importlib.util.spec_from_file_location("migration_0023", MIGRATION_0023)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        (
            "https://slippery-hill.com/content/june-apple-2/?x=1",
            ("slippery_hill", None, "https://www.slippery-hill.com/content/june-apple-2"),
        ),
        (
            "https://www.slippery-hill.com/system/files/recordings/a.mp3",
            (
                "slippery_hill",
                "recordings/a.mp3",
                "https://www.slippery-hill.com/system/files/recordings/a.mp3",
            ),
        ),
        (
            "https://www.slippery-hill.com/system/files/../x.mp3",
            ("slippery_hill", None, "https://www.slippery-hill.com/system/files/../x.mp3"),
        ),
        (
            "https://m.slippery-hill.com/content/june-apple-2",
            ("slippery_hill", None, "https://www.slippery-hill.com/content/june-apple-2"),
        ),
        (
            "https://www.slippery-hill.com/tune-search?q=x&utm_source=y#top",
            ("slippery_hill", None, "https://www.slippery-hill.com/tune-search?q=x"),
        ),
        (
            "https://www.slippery-hill.com/system/files/a:b.mp3",
            ("slippery_hill", None, "https://www.slippery-hill.com/system/files/a:b.mp3"),
        ),
        (
            "https://www.slippery-hill.com/system/files/x%2E.mp3",
            ("slippery_hill", None, "https://www.slippery-hill.com/system/files/x%2E.mp3"),
        ),
        (
            f"https://www.slippery-hill.com/system/files/{'a' * 197}.mp3",
            ("slippery_hill", None, f"https://www.slippery-hill.com/system/files/{'a' * 197}.mp3"),
        ),
        ("https://example.com/system/files/a.mp3", None),
        ("http://[abc", None),
    ],
)
def test_0023_redetects_slippery_hill(url: str, expected) -> None:
    assert load_0023().redetect(url) == expected


async def test_0023_backfills_links_and_settings(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    tune = "018f0000-0000-7000-8000-000000000002"
    settings = "018f0000-0000-7000-8000-000000000003"
    hill = "018f0000-0000-7000-8000-000000000011"
    other = "018f0000-0000-7000-8000-000000000012"
    links = {
        hill: "https://slippery-hill.com/content/june-apple-2",
        other: "https://example.com/x.mp3",
    }
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0022")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into tunes (id, owner_user_id, title, created_at, updated_at) "
                    "values (:id, :owner, 'June Apple', now(), now())"
                ),
                {"id": tune, "owner": user},
            )
            for link_id, url in links.items():
                await conn.execute(
                    text(
                        "insert into recording_links "
                        "(id, tune_id, added_by_user_id, url, provider, created_at, updated_at) "
                        "values (:id, :tune, :user, :url, 'other', now(), now())"
                    ),
                    {"id": link_id, "tune": tune, "user": user, "url": url},
                )
            await conn.execute(
                text(
                    "insert into user_settings (id, user_id, instruments, audio_quality, "
                    "search_providers, created_at, updated_at) "
                    "values (:id, :user, '{}', 'standard', '{apple_music,youtube}', now(), now())"
                ),
                {"id": settings, "user": user},
            )
            before_links = dict(
                (await conn.execute(text("select id::text, server_seq from recording_links")))
                .tuples()
                .all()
            )
            before_settings = (
                await conn.execute(text("select server_seq from user_settings"))
            ).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = {
            row.id: row
            for row in await conn.execute(
                text("select id::text as id, provider, url, server_seq from recording_links")
            )
        }
        stored = (
            await conn.execute(text("select search_providers, server_seq from user_settings"))
        ).one()
    assert (rows[hill].provider, rows[hill].url) == (
        "slippery_hill",
        "https://www.slippery-hill.com/content/june-apple-2",
    )
    assert rows[hill].server_seq > before_links[hill]
    assert (rows[other].provider, rows[other].url, rows[other].server_seq) == (
        "other",
        "https://example.com/x.mp3",
        before_links[other],
    )
    assert stored.search_providers == ["apple_music", "slippery_hill", "youtube"]
    assert stored.server_seq > before_settings


async def test_downgrade_to_0022_and_back_restores_head_shape(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    tune = "018f0000-0000-7000-8000-000000000002"
    settings = "018f0000-0000-7000-8000-000000000003"
    link = "018f0000-0000-7000-8000-000000000011"
    insert_link = text(
        "insert into recording_links (id, tune_id, added_by_user_id, url, provider, "
        "created_at, updated_at) values (:id, :tune, :user, 'https://x', 'slippery_hill', "
        "now(), now())"
    )
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            text(
                "insert into tunes (id, owner_user_id, title, created_at, updated_at) "
                "values (:id, :owner, 'June Apple', now(), now())"
            ),
            {"id": tune, "owner": user},
        )
        await conn.execute(
            text(
                "insert into recording_links (id, tune_id, added_by_user_id, url, provider, "
                "provider_ref, created_at, updated_at) values (:id, :tune, :user, "
                "'https://www.slippery-hill.com/system/files/a.mp3', 'slippery_hill', "
                "'a.mp3', now(), now())"
            ),
            {"id": link, "tune": tune, "user": user},
        )
        await conn.execute(
            text(
                "insert into user_settings (id, user_id, instruments, audio_quality, "
                "search_providers, created_at, updated_at) values (:id, :user, '{}', "
                "'standard', '{apple_music,slippery_hill,youtube}', now(), now())"
            ),
            {"id": settings, "user": user},
        )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0022")
        async with engine.connect() as conn:
            reverted = (
                await conn.execute(
                    text("select provider, provider_ref from recording_links where id = :id"),
                    {"id": link},
                )
            ).one()
            providers = (
                await conn.execute(text("select search_providers from user_settings"))
            ).scalar_one()
            default = (
                await conn.execute(
                    text(
                        "select column_default from information_schema.columns "
                        "where table_name = 'user_settings' and column_name = 'search_providers'"
                    )
                )
            ).scalar_one()
        assert tuple(reverted) == ("other", None)
        assert providers == ["apple_music", "youtube"]
        assert "slippery_hill" not in default
        with pytest.raises(IntegrityError, match="ck_recording_links_provider"):
            async with engine.begin() as conn:
                await conn.execute(
                    insert_link,
                    {"id": "018f0000-0000-7000-8000-000000000012", "tune": tune, "user": user},
                )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        default = (
            await conn.execute(
                text(
                    "select column_default from information_schema.columns "
                    "where table_name = 'user_settings' and column_name = 'search_providers'"
                )
            )
        ).scalar_one()
    assert "slippery_hill" in default


SEED_RECORDING = text(
    "insert into recordings (id, user_id, source, added_at, recorded_at, recorded_precision, "
    "state, created_at, updated_at) values ('018f0000-0000-7000-8000-000000000021', :user, "
    ":source, now(), now(), 'time', 'ready', now(), now())"
)
SEED_RECORDING_BEFORE_0028 = text(
    "insert into recordings (id, user_id, source, recorded_at, state, created_at, updated_at) "
    "values ('018f0000-0000-7000-8000-000000000021', :user, :source, now(), 'ready', now(), "
    "now())"
)


async def _seed_recording(engine, source: str = "microphone", *, before_0028: bool = False) -> None:
    user = "018f0000-0000-7000-8000-000000000001"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values (:id, 'user_a', now(), now())"
            ),
            {"id": user},
        )
        await conn.execute(
            SEED_RECORDING_BEFORE_0028 if before_0028 else SEED_RECORDING,
            {"user": user, "source": source},
        )


async def test_0024_existing_recordings_read_as_own(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0023")
        await _seed_recording(engine, before_0028=True)
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
        async with engine.connect() as conn:
            row = (await conn.execute(text("select origin, origin_url from recordings"))).one()
        assert tuple(row) == ("own", None)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_downgrade_to_0023_drops_the_columns_and_upgrade_restores_them(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    query = text(
        "select count(*) from information_schema.columns "
        "where table_name = 'recordings' and column_name in ('origin', 'origin_url')"
    )
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0023")
        async with engine.connect() as conn:
            assert (await conn.execute(query)).scalar_one() == 0
        with pytest.raises(IntegrityError, match="ck_recordings_source"):
            await _seed_recording(engine, source="import", before_0028=True)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        assert (await conn.execute(query)).scalar_one() == 2


async def test_0024_downgrade_refuses_while_an_import_exists(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
            )
        )
        await conn.execute(
            text(
                "insert into recordings (id, user_id, source, origin, origin_url, added_at, "
                "state, created_at, updated_at) values "
                "('018f0000-0000-7000-8000-000000000021', "
                "'018f0000-0000-7000-8000-000000000001', 'import', 'slippery_hill', "
                "'https://www.slippery-hill.com/recording/1', now(), 'ready', now(), now())"
            )
        )
    with pytest.raises(RuntimeError, match="source 'import'"):
        await anyio.to_thread.run_sync(command.downgrade, config, "0023")


async def _seed_job(engine, kind: str) -> None:
    await _seed_recording(engine)
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) "
                "values ('018f0000-0000-7000-8000-000000000031', "
                "'018f0000-0000-7000-8000-000000000021', "
                "'018f0000-0000-7000-8000-000000000001', :kind, 0, now())"
            ),
            {"kind": kind},
        )


async def test_0025_jobs_accept_the_import_kind(engine, truncate_all: None) -> None:
    await _seed_job(engine, "import")
    async with engine.connect() as conn:
        kinds = (await conn.execute(text("select kind from jobs"))).scalars().all()
    assert kinds == ["import"]


async def test_downgrade_to_0024_deletes_import_jobs_and_upgrade_restores_the_kind(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await _seed_job(engine, "import")
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0024")
        async with engine.connect() as conn:
            assert (await conn.execute(text("select count(*) from jobs"))).scalar_one() == 0
        with pytest.raises(IntegrityError, match="ck_jobs_kind"):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "insert into jobs (id, recording_id, user_id, kind, attempts, "
                        "created_at) values ('018f0000-0000-7000-8000-000000000032', "
                        "'018f0000-0000-7000-8000-000000000021', "
                        "'018f0000-0000-7000-8000-000000000001', 'import', 0, now())"
                    )
                )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) "
                "values ('018f0000-0000-7000-8000-000000000033', "
                "'018f0000-0000-7000-8000-000000000021', "
                "'018f0000-0000-7000-8000-000000000001', 'import', 0, now())"
            )
        )


async def test_downgrade_to_0024_fails_the_recordings_of_deleted_import_jobs(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    queued = "018f0000-0000-7000-8000-000000000021"
    transcoding = "018f0000-0000-7000-8000-000000000022"
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
            )
        )
        await conn.execute(
            text(
                "insert into recordings (id, user_id, source, origin, origin_url, added_at, "
                "state, created_at, updated_at) values "
                "(:queued, '018f0000-0000-7000-8000-000000000001', 'import', 'slippery_hill', "
                "'https://www.slippery-hill.com/content/x', now(), 'processing', now(), now()), "
                "(:transcoding, '018f0000-0000-7000-8000-000000000001', 'upload', 'own', "
                "null, now(), 'processing', now(), now())"
            ),
            {"queued": queued, "transcoding": transcoding},
        )
        await conn.execute(
            text(
                "insert into jobs (id, recording_id, user_id, kind, attempts, created_at) values "
                "('018f0000-0000-7000-8000-000000000031', :queued, "
                "'018f0000-0000-7000-8000-000000000001', 'import', 0, now()), "
                "('018f0000-0000-7000-8000-000000000032', :transcoding, "
                "'018f0000-0000-7000-8000-000000000001', 'transcode', 0, now())"
            ),
            {"queued": queued, "transcoding": transcoding},
        )
    seq_query = text("select id::text, server_seq from recordings")
    async with engine.connect() as conn:
        seq_before = dict((await conn.execute(seq_query)).tuples().all())
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0024")
        async with engine.connect() as conn:
            rows = {
                row[0]: row[1:]
                for row in (
                    await conn.execute(
                        text("select id::text, state, error, server_seq from recordings")
                    )
                ).tuples()
            }
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    state, error, seq = rows[queued]
    assert (state, error) == ("failed", "Couldn't reach Slippery-Hill")
    assert seq > seq_before[queued]
    assert rows[transcoding] == ("processing", None, seq_before[transcoding])


async def test_0027_keeps_recording_slots_and_downgrade_drops_page_slots(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    rec = "018f0000-0000-7000-8000-000000000031"
    tune = "018f0000-0000-7000-8000-000000000032"
    page = "018f0000-0000-7000-8000-000000000033"
    expires = datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0026")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, recorded_at, state, "
                    "created_at, updated_at) values "
                    "(:id, :user, 'microphone', now(), 'pending_upload', now(), now())"
                ),
                {"id": rec, "user": user},
            )
            await conn.execute(
                text(
                    "insert into upload_slots (recording_id, user_id, declared_bytes, "
                    "content_type, expires_at) values (:rec, :user, 1234, 'audio/mp4', :exp)"
                ),
                {"rec": rec, "user": user, "exp": expires},
            )

        await anyio.to_thread.run_sync(command.upgrade, config, "0027")
        async with engine.connect() as conn:
            [slot] = (
                await conn.execute(
                    text(
                        "select id, recording_id::text as recording_id, notation_page_id, "
                        "declared_bytes, content_type, expires_at from upload_slots"
                    )
                )
            ).all()
        assert slot.id is not None
        assert slot.recording_id == rec
        assert slot.notation_page_id is None
        assert (slot.declared_bytes, slot.content_type, slot.expires_at) == (
            1234,
            "audio/mp4",
            expires,
        )

        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into tunes (id, owner_user_id, title, modes, is_crooked, "
                    "created_at, updated_at) values "
                    "(:id, :user, 't', '{}', false, now(), now())"
                ),
                {"id": tune, "user": user},
            )
            await conn.execute(
                text(
                    "insert into notation_pages (id, user_id, tune_id, width, height, "
                    "created_at, updated_at) values "
                    "(:id, :user, :tune, 10, 10, now(), now())"
                ),
                {"id": page, "user": user, "tune": tune},
            )
            await conn.execute(
                text(
                    "insert into upload_slots (id, notation_page_id, user_id, declared_bytes, "
                    "content_type, expires_at) values "
                    "(gen_random_uuid(), :page, :user, 99, 'image/jpeg', :exp)"
                ),
                {"page": page, "user": user, "exp": expires},
            )

        await anyio.to_thread.run_sync(command.downgrade, config, "0026")
        async with engine.connect() as conn:
            rows = (
                await conn.execute(
                    text(
                        "select recording_id::text as recording_id, declared_bytes, "
                        "content_type, expires_at from upload_slots"
                    )
                )
            ).all()
        assert [tuple(r) for r in rows] == [(rec, 1234, "audio/mp4", expires)]
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_upload_slot_model_names_the_unique_constraints_the_migration_creates(
    session: AsyncSession,
) -> None:
    migrated = await session.scalars(
        text(
            "select conname from pg_constraint "
            "where conrelid = 'upload_slots'::regclass and contype = 'u'"
        )
    )
    declared = {c.name for c in UploadSlot.__table__.constraints if isinstance(c, UniqueConstraint)}
    assert (
        declared
        == set(migrated)
        == {
            "uq_upload_slots_recording_id",
            "uq_upload_slots_scan_id",
        }
    )


ADDED = datetime(2026, 5, 1, 9, 30, tzinfo=UTC)
TAKE = "018f0000-0000-7000-8000-000000000021"
UPLOAD = "018f0000-0000-7000-8000-000000000022"
IMPORT = "018f0000-0000-7000-8000-000000000023"
DATES = text(
    "select id::text, added_at, recorded_at, recorded_precision from recordings order by id"
)


async def _seed_three_sources(engine) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
            )
        )
        await conn.execute(
            text(
                "insert into recordings (id, user_id, source, origin, origin_url, recorded_at, "
                "state, created_at, updated_at) values "
                "(:take, '018f0000-0000-7000-8000-000000000001', 'microphone', 'own', null, "
                ":at, 'ready', now(), now()), "
                "(:upload, '018f0000-0000-7000-8000-000000000001', 'upload', 'own', null, "
                ":at, 'ready', now(), now()), "
                "(:import, '018f0000-0000-7000-8000-000000000001', 'import', 'slippery_hill', "
                "'https://www.slippery-hill.com/content/x', :at, 'ready', now(), now())"
            ),
            {"take": TAKE, "upload": UPLOAD, "import": IMPORT, "at": ADDED},
        )


async def test_0028_keeps_only_a_takes_recorded_date(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0027")
        await _seed_three_sources(engine)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.connect() as conn:
        rows = (await conn.execute(DATES)).tuples().all()
    assert rows == [
        (TAKE, ADDED, ADDED, "time"),
        (UPLOAD, ADDED, None, None),
        (IMPORT, ADDED, None, None),
    ]


@pytest.mark.parametrize(
    "statement",
    [
        "update recordings set recorded_precision = null",
        "update recordings set recorded_at = null",
    ],
    ids=["date-without-precision", "precision-without-date"],
)
async def test_0028_refuses_a_recorded_date_without_its_precision(
    engine, truncate_all: None, statement: str
) -> None:
    await _seed_recording(engine, source="upload")
    with pytest.raises(IntegrityError, match="ck_recordings_recorded_date"):
        async with engine.begin() as conn:
            await conn.execute(text(statement))


async def test_0028_refuses_an_unknown_precision(engine, truncate_all: None) -> None:
    await _seed_recording(engine, source="upload")
    with pytest.raises(IntegrityError, match="ck_recordings_recorded_precision"):
        async with engine.begin() as conn:
            await conn.execute(text("update recordings set recorded_precision = 'decade'"))


async def test_downgrade_to_0027_restores_a_recorded_date_on_every_row(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    take_at = datetime(1998, 10, 3, 16, 12, tzinfo=UTC)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0027")
        await _seed_three_sources(engine)
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
        async with engine.begin() as conn:
            await conn.execute(
                text("update recordings set recorded_at = :at where id = :id"),
                {"at": take_at, "id": TAKE},
            )
        await anyio.to_thread.run_sync(command.downgrade, config, "0027")
        async with engine.connect() as conn:
            rows = (
                (
                    await conn.execute(
                        text("select id::text, recorded_at from recordings order by id")
                    )
                )
                .tuples()
                .all()
            )
            columns = (
                await conn.execute(
                    text(
                        "select count(*) from information_schema.columns "
                        "where table_name = 'recordings' "
                        "and column_name in ('added_at', 'recorded_precision')"
                    )
                )
            ).scalar_one()
            nullable = (
                await conn.execute(
                    text(
                        "select is_nullable from information_schema.columns "
                        "where table_name = 'recordings' and column_name = 'recorded_at'"
                    )
                )
            ).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    assert rows == [(TAKE, take_at), (UPLOAD, ADDED), (IMPORT, ADDED)]
    assert columns == 0
    assert nullable == "NO"


async def _seed_user_settings(engine, quality: str) -> None:
    async with engine.begin() as conn:
        await conn.execute(
            text(
                "insert into users (id, clerk_user_id, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
            )
        )
        await conn.execute(
            text(
                "insert into user_settings "
                "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                "values ('018f0000-0000-7000-8000-000000000041', "
                "'018f0000-0000-7000-8000-000000000001', '{}', :quality, now(), now())"
            ),
            {"quality": quality},
        )


async def test_0029_accepts_highest(engine, truncate_all: None) -> None:
    await _seed_user_settings(engine, "highest")
    async with engine.connect() as conn:
        quality = (await conn.execute(text("select audio_quality from user_settings"))).scalar_one()
    assert quality == "highest"
    with pytest.raises(IntegrityError, match="ck_user_settings_audio_quality"):
        async with engine.begin() as conn:
            await conn.execute(text("update user_settings set audio_quality = 'lossless'"))


async def test_downgrade_to_0028_maps_highest_to_high(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await _seed_user_settings(engine, "highest")
    async with engine.connect() as conn:
        before = (await conn.execute(text("select server_seq from user_settings"))).scalar_one()
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0028")
        async with engine.connect() as conn:
            row = (
                await conn.execute(text("select audio_quality, server_seq from user_settings"))
            ).one()
        assert row.audio_quality == "high"
        assert row.server_seq > before
        with pytest.raises(IntegrityError, match="ck_user_settings_audio_quality"):
            async with engine.begin() as conn:
                await conn.execute(text("update user_settings set audio_quality = 'highest'"))
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


async def test_0030_queues_reencode_backfill(engine, database_url: str, truncate_all: None) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    with_original = "018f0000-0000-7000-8000-000000000021"
    without_original = "018f0000-0000-7000-8000-000000000022"
    deleted = "018f0000-0000-7000-8000-000000000023"
    failed = "018f0000-0000-7000-8000-000000000024"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0029")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into recordings (id, user_id, source, added_at, state, "
                    "original_key, created_at, updated_at, deleted_at) values "
                    "(:with_original,:user, 'upload', now(), 'ready', 'k1', now(), now(), null), "
                    "(:without_original, :user, 'upload', now(), 'ready', null, now(), now(), "
                    "null), "
                    "(:deleted, :user, 'upload', now(), 'ready', 'k3', now(), now(), now()), "
                    "(:failed, :user, 'upload', now(), 'failed', 'k4', now(), now(), null)"
                ),
                {
                    "with_original": with_original,
                    "without_original": without_original,
                    "deleted": deleted,
                    "failed": failed,
                    "user": user,
                },
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        jobs = {
            row[0]: row[1:]
            for row in (
                await conn.execute(
                    text("select recording_id::text, kind, locked_until is null from jobs")
                )
            ).tuples()
        }
    assert jobs == {with_original: ("reencode", True)}


async def test_downgrade_to_0029_deletes_reencode_jobs(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    await _seed_job(engine, "reencode")
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0029")
        async with engine.connect() as conn:
            assert (await conn.execute(text("select count(*) from jobs"))).scalar_one() == 0
        with pytest.raises(IntegrityError, match="ck_jobs_kind"):
            async with engine.begin() as conn:
                await conn.execute(
                    text(
                        "insert into jobs (id, recording_id, user_id, kind, attempts, "
                        "created_at) values ('018f0000-0000-7000-8000-000000000032', "
                        "'018f0000-0000-7000-8000-000000000021', "
                        "'018f0000-0000-7000-8000-000000000001', 'reencode', 0, now())"
                    )
                )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


ACTIVITY_INDEXES = {
    "ix_status_changes_user_id_server_seq",
    "ix_status_changes_user_id_changed_at",
    "ix_play_events_user_id_server_seq",
    "ix_play_events_user_id_started_at",
    "ix_practice_sessions_user_id_server_seq",
    "ix_practice_sessions_user_id_started_at",
}


async def test_0031_creates_activity_tables(session: AsyncSession) -> None:
    tables = set(
        (
            await session.execute(
                text(
                    "select table_name from information_schema.tables "
                    "where table_name in ('status_changes', 'play_events', 'practice_sessions')"
                )
            )
        ).scalars()
    )
    indexes = set(
        (
            await session.execute(
                text(
                    "select indexname from pg_indexes "
                    "where tablename in ('status_changes', 'play_events', 'practice_sessions')"
                )
            )
        ).scalars()
    )
    assert tables == {"status_changes", "play_events", "practice_sessions"}
    assert indexes >= ACTIVITY_INDEXES


async def test_0031_seeds_one_status_row_per_live_user_tune(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user_a = "018f0000-0000-7000-8000-000000000041"
    user_b = "018f0000-0000-7000-8000-000000000051"
    user_c = "018f0000-0000-7000-8000-000000000061"
    tunes = [f"018f0000-0000-7000-8000-00000000004{n}" for n in range(2, 6)]
    a_late = "018f0000-0000-7000-8000-000000000046"
    a_early = "018f0000-0000-7000-8000-000000000047"
    a_gone = "018f0000-0000-7000-8000-000000000048"
    b_live = "018f0000-0000-7000-8000-000000000052"
    c_gone = "018f0000-0000-7000-8000-000000000062"
    early = datetime(2026, 1, 2, 3, 4, 5, tzinfo=UTC)
    late = datetime(2026, 2, 2, 3, 4, 5, tzinfo=UTC)
    # Each tuple: id, user, tune, status, created_at, deleted.
    user_tunes = [
        (b_live, user_b, tunes[0], "known", early, False),
        (a_late, user_a, tunes[0], "learning", late, False),
        (a_early, user_a, tunes[1], "want_to_learn", early, False),
        (a_gone, user_a, tunes[2], "known", early, True),
        (c_gone, user_c, tunes[3], "known", early, True),
    ]
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0030")
        async with engine.begin() as conn:
            for user, clerk in ((user_a, "user_a"), (user_b, "user_b"), (user_c, "user_c")):
                await conn.execute(
                    text(
                        "insert into users (id, clerk_user_id, created_at, updated_at) "
                        "values (:id, :clerk, now(), now())"
                    ),
                    {"id": user, "clerk": clerk},
                )
            for tune in tunes:
                await conn.execute(
                    text(
                        "insert into tunes (id, owner_user_id, title, created_at, updated_at) "
                        "values (:id, :user, 'Sally Ann', now(), now())"
                    ),
                    {"id": tune, "user": user_a},
                )
            for row_id, user, tune, status, created, deleted in user_tunes:
                await conn.execute(
                    text(
                        "insert into user_tunes (id, user_id, tune_id, status, created_at, "
                        "updated_at, deleted_at) values (:id, :user, :tune, :status, :created, "
                        "now(), case when :deleted then now() end)"
                    ),
                    {
                        "id": row_id,
                        "user": user,
                        "tune": tune,
                        "status": status,
                        "created": created,
                        "deleted": deleted,
                    },
                )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")

    async with engine.connect() as conn:
        rows = (
            (
                await conn.execute(
                    text(
                        "select user_id::text, user_tune_id::text, from_status, to_status, "
                        "changed_at from status_changes order by server_seq"
                    )
                )
            )
            .tuples()
            .all()
        )
    assert rows == [
        (user_a, a_early, None, "want_to_learn", early),
        (user_a, a_late, None, "learning", late),
        (user_b, b_live, None, "known", early),
    ]


async def _insert_play(
    session: AsyncSession, *, recording: bool, link: bool, context: str, listened_ms: int
) -> None:
    await session.execute(
        text(
            "insert into play_events (id, user_id, recording_id, link_id, context, started_at, "
            "listened_ms, created_at) values (gen_random_uuid(), "
            "'018f0000-0000-7000-8000-000000000001', :recording, :link, :context, now(), "
            ":listened, now())"
        ),
        {
            "recording": "018f0000-0000-7000-8000-000000000071" if recording else None,
            "link": "018f0000-0000-7000-8000-000000000072" if link else None,
            "context": context,
            "listened": listened_ms,
        },
    )


@pytest.mark.parametrize(
    ("recording", "link", "context", "listened_ms", "constraint"),
    [
        (True, True, "row", 0, "ck_play_events_one_source"),
        (False, False, "row", 0, "ck_play_events_one_source"),
        (True, False, "radio", 0, "ck_play_events_context"),
        (True, False, "row", -1, "ck_play_events_listened_ms"),
    ],
)
async def test_play_events_checks_reject_bad_rows(
    session: AsyncSession,
    recording: bool,  # noqa: FBT001
    link: bool,  # noqa: FBT001
    context: str,
    listened_ms: int,
    constraint: str,
) -> None:
    await _seed_user(session)
    with pytest.raises(IntegrityError, match=constraint):
        async with session.begin_nested():
            await _insert_play(
                session, recording=recording, link=link, context=context, listened_ms=listened_ms
            )


@pytest.mark.parametrize("context", list(PlayContext))
async def test_play_events_checks_accept_every_context(
    session: AsyncSession, context: PlayContext
) -> None:
    await _seed_user(session)
    await _insert_play(session, recording=True, link=False, context=context.value, listened_ms=0)
    count = await session.scalar(text("select count(*) from play_events"))
    assert count == 1


async def test_practice_sessions_check_rejects_negative_duration(session: AsyncSession) -> None:
    await _seed_user(session)
    insert = (
        "insert into practice_sessions (id, user_id, recording_id, started_at, duration_ms, "
        "speed_percent, pitch_cents, created_at) values (gen_random_uuid(), "
        "'018f0000-0000-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000071', "
        "now(), :duration, 100, 0, now())"
    )
    await session.execute(text(insert), {"duration": 0})
    with pytest.raises(IntegrityError, match="ck_practice_sessions_duration_ms"):
        async with session.begin_nested():
            await session.execute(text(insert), {"duration": -1})


async def test_downgrade_to_0030_drops_activity_tables(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0030")
        async with engine.connect() as conn:
            remaining = (
                await conn.execute(
                    text(
                        "select count(*) from information_schema.tables "
                        "where table_name in ('status_changes', 'play_events', 'practice_sessions')"
                    )
                )
            ).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    assert remaining == 0


SCAN_NAMES = {
    "scans_pkey",
    "scans_user_id_fkey",
    "scans_tune_id_fkey",
    "ck_scans_width",
    "ck_scans_height",
    "ck_scans_state",
    "ix_scans_tune_id",
    "ix_scans_user_id_server_seq",
    "upload_slots_scan_id_fkey",
    "uq_upload_slots_scan_id",
}
NOTATION_NAMES = {
    "notation_pages_pkey",
    "notation_pages_user_id_fkey",
    "notation_pages_tune_id_fkey",
    "ck_notation_pages_width",
    "ck_notation_pages_height",
    "ck_notation_pages_state",
    "ix_notation_pages_tune_id",
    "ix_notation_pages_user_id_server_seq",
    "upload_slots_notation_page_id_fkey",
    "uq_upload_slots_notation_page_id",
}


async def _scan_schema_names(engine) -> set[str]:
    """Every constraint and index on the scan table and on upload_slots."""
    async with engine.connect() as conn:
        rows = await conn.execute(
            text(
                "select conname from pg_constraint c join pg_class t on t.oid = c.conrelid "
                "where t.relname in ('scans', 'notation_pages', 'upload_slots') "
                "union select indexname from pg_indexes "
                "where tablename in ('scans', 'notation_pages', 'upload_slots')"
            )
        )
        return set(rows.scalars())


async def test_0032_renames_notation_pages_to_scans_keeping_rows_and_slots(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000001"
    tune = "018f0000-0000-7000-8000-000000000032"
    scan = "018f0000-0000-7000-8000-000000000033"
    expires = datetime(2030, 1, 2, 3, 4, 5, tzinfo=UTC)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0031")
        assert await _scan_schema_names(engine) >= NOTATION_NAMES
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into tunes (id, owner_user_id, title, modes, is_crooked, "
                    "created_at, updated_at) values "
                    "(:id, :user, 't', '{}', false, now(), now())"
                ),
                {"id": tune, "user": user},
            )
            await conn.execute(
                text(
                    "insert into notation_pages (id, user_id, tune_id, width, height, state, "
                    "file_key, file_bytes, created_at, updated_at) values "
                    "(:id, :user, :tune, 10, 20, 'ready', 'k/notation/p/page.jpg', 7, "
                    "now(), now())"
                ),
                {"id": scan, "user": user, "tune": tune},
            )
            await conn.execute(
                text(
                    "insert into upload_slots (id, notation_page_id, user_id, declared_bytes, "
                    "content_type, expires_at) values "
                    "(gen_random_uuid(), :scan, :user, 99, 'image/jpeg', :exp)"
                ),
                {"scan": scan, "user": user, "exp": expires},
            )

        await anyio.to_thread.run_sync(command.upgrade, config, "0032")
        names = await _scan_schema_names(engine)
        assert names >= SCAN_NAMES
        assert not {name for name in names if "notation" in name}
        async with engine.connect() as conn:
            [row] = (
                await conn.execute(
                    text(
                        "select id::text as id, width, height, state, file_key, file_bytes "
                        "from scans"
                    )
                )
            ).all()
            [slot] = (
                await conn.execute(
                    text("select scan_id::text as scan_id, declared_bytes from upload_slots")
                )
            ).all()
        assert tuple(row) == (scan, 10, 20, "ready", "k/notation/p/page.jpg", 7)
        assert tuple(slot) == (scan, 99)

        await anyio.to_thread.run_sync(command.downgrade, config, "0031")
        names = await _scan_schema_names(engine)
        assert names >= NOTATION_NAMES
        assert not {name for name in names if "scan" in name}
        async with engine.connect() as conn:
            slot_columns = set(
                (
                    await conn.execute(
                        text(
                            "select column_name from information_schema.columns "
                            "where table_name = 'upload_slots'"
                        )
                    )
                ).scalars()
            )
            scans_table = (await conn.execute(text("select to_regclass('scans')"))).scalar_one()
        assert "scan_id" not in slot_columns
        assert scans_table is None
        async with engine.connect() as conn:
            [row] = (
                await conn.execute(text("select id::text as id, file_key from notation_pages"))
            ).all()
            [slot] = (
                await conn.execute(
                    text("select notation_page_id::text as page_id from upload_slots")
                )
            ).all()
        assert tuple(row) == (scan, "k/notation/p/page.jpg")
        assert tuple(slot) == (scan,)
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")


SCAN_VIEW_INDEXES = {"ix_scan_views_user_id_server_seq", "ix_scan_views_user_id_started_at"}


async def test_0033_creates_scan_views(session: AsyncSession) -> None:
    table = await session.scalar(text("select to_regclass('scan_views')"))
    indexes = set(
        (
            await session.execute(
                text("select indexname from pg_indexes where tablename = 'scan_views'")
            )
        ).scalars()
    )
    assert table == "scan_views"
    assert indexes >= SCAN_VIEW_INDEXES


async def _insert_scan_view(
    session: AsyncSession, *, context: str, list_id: str | None, viewed_ms: int
) -> None:
    await session.execute(
        text(
            "insert into scan_views (id, user_id, tune_id, context, list_id, started_at, "
            "viewed_ms, created_at) values (gen_random_uuid(), "
            "'018f0000-0000-7000-8000-000000000001', '018f0000-0000-7000-8000-000000000073', "
            ":context, :list_id, now(), :viewed, now())"
        ),
        {"context": context, "list_id": list_id, "viewed": viewed_ms},
    )


LIST_ID = "018f0000-0000-7000-8000-000000000074"


@pytest.mark.parametrize(
    ("context", "list_id", "viewed_ms", "constraint"),
    [
        ("dock", None, 0, "ck_scan_views_context"),
        ("row", LIST_ID, 0, "ck_scan_views_list_id_context"),
        ("tune", LIST_ID, 0, "ck_scan_views_list_id_context"),
        ("tune", None, -1, "ck_scan_views_viewed_ms"),
    ],
)
async def test_scan_views_checks_reject_bad_rows(
    session: AsyncSession, context: str, list_id: str | None, viewed_ms: int, constraint: str
) -> None:
    await _seed_user(session)
    with pytest.raises(IntegrityError, match=constraint):
        async with session.begin_nested():
            await _insert_scan_view(session, context=context, list_id=list_id, viewed_ms=viewed_ms)


@pytest.mark.parametrize(
    ("context", "list_id"),
    [("tune", None), ("row", None), ("list", None), ("list", LIST_ID)],
)
async def test_scan_views_checks_accept_valid_rows(
    session: AsyncSession, context: str, list_id: str | None
) -> None:
    await _seed_user(session)
    await _insert_scan_view(session, context=context, list_id=list_id, viewed_ms=0)
    assert await session.scalar(text("select count(*) from scan_views")) == 1


async def test_downgrade_to_0032_drops_scan_views(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0032")
        async with engine.connect() as conn:
            table = (await conn.execute(text("select to_regclass('scan_views')"))).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    assert table is None


async def test_0036_starts_existing_settings_with_no_new_tune_defaults(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    user = "018f0000-0000-7000-8000-000000000081"
    settings = "018f0000-0000-7000-8000-000000000082"
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0035")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, 'user_a', now(), now())"
                ),
                {"id": user},
            )
            await conn.execute(
                text(
                    "insert into user_settings "
                    "(id, user_id, instruments, audio_quality, created_at, updated_at) "
                    "values (:id, :user, '{}', 'standard', now(), now())"
                ),
                {"id": settings, "user": user},
            )
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    async with engine.begin() as conn:
        stored = (
            await conn.execute(text("select new_tune_genre, new_tune_status from user_settings"))
        ).one()
    assert tuple(stored) == (None, "want_to_learn")
    with pytest.raises(IntegrityError, match="ck_user_settings_new_tune_status"):
        async with engine.begin() as conn:
            await conn.execute(text("update user_settings set new_tune_status = 'mastered'"))


async def test_0037_gives_existing_users_a_thirty_day_trial_and_downgrade_drops_it(
    engine, database_url: str, truncate_all: None
) -> None:
    config = Config("alembic.ini")
    config.set_main_option("sqlalchemy.url", database_url)
    users = ["018f0000-0000-7000-8000-000000000091", "018f0000-0000-7000-8000-000000000092"]
    try:
        await anyio.to_thread.run_sync(command.downgrade, config, "0036")
        async with engine.begin() as conn:
            await conn.execute(
                text(
                    "insert into users (id, clerk_user_id, created_at, updated_at) "
                    "values (:id, :clerk, now(), now())"
                ),
                [{"id": user, "clerk": f"user_{n}"} for n, user in enumerate(users)],
            )
        await anyio.to_thread.run_sync(command.upgrade, config, "0037")
        async with engine.connect() as conn:
            grants = (
                await conn.execute(
                    text(
                        "select kind, source, environment, "
                        "expires_at - now() between interval '29 days' and interval '31 days' "
                        "as in_window, expires_at, user_id from grants order by user_id"
                    )
                )
            ).all()
            entitlements = (
                await conn.execute(
                    text(
                        "select premium_source, trial_ends_at, premium_expires_at, "
                        "premium_quota_bytes, free_quota_bytes, server_seq, user_id "
                        "from entitlements order by user_id"
                    )
                )
            ).all()
        await anyio.to_thread.run_sync(command.downgrade, config, "0036")
        async with engine.connect() as conn:
            tables = [
                (await conn.execute(text(f"select to_regclass('{name}')"))).scalar_one()
                for name in ("grants", "pending_comps", "entitlements")
            ]
            column = (
                await conn.execute(
                    text(
                        "select count(*) from information_schema.columns "
                        "where table_name = 'users' and column_name = 'last_synced_at'"
                    )
                )
            ).scalar_one()
    finally:
        await anyio.to_thread.run_sync(command.upgrade, config, "head")
    assert [str(g.user_id) for g in grants] == users
    assert [str(e.user_id) for e in entitlements] == users
    for grant, row in zip(grants, entitlements, strict=True):
        assert tuple(grant)[:4] == ("premium", "trial", "production", True)
        assert row.premium_source == "trial"
        assert row.trial_ends_at == grant.expires_at == row.premium_expires_at
        assert (row.premium_quota_bytes, row.free_quota_bytes) == (104_857_600, 52_428_800)
        assert row.server_seq is not None
    assert tables == [None, None, None]
    assert column == 0
