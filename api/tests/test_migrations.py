"""Migrations produce the expected schema."""

import importlib.util
from datetime import UTC, datetime
from pathlib import Path

import anyio
import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

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


async def test_mode_check_constraint_accepts_modal(session: AsyncSession) -> None:
    await session.execute(
        text(
            "insert into users (id, clerk_user_id, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000001', 'user_a', now(), now())"
        )
    )
    await session.execute(
        text(
            "insert into tunes (id, owner_user_id, title, mode, is_crooked, created_at, updated_at) "
            "values ('018f0000-0000-7000-8000-000000000002', '018f0000-0000-7000-8000-000000000001', "
            "'Cluck Old Hen', 'modal', false, now(), now())"
        )
    )
    stored = await session.execute(text("select mode from tunes"))
    assert stored.scalar_one() == "modal"


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
    assert rows[other_settings].server_seq == before[other_settings]


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
            "insert into recordings (id, user_id, tune_id, source, recorded_at, position, "
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
                "insert into recordings (id, user_id, source, recorded_at, position, state, "
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
