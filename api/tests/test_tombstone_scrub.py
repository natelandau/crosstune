"""A delete clears the row's content in the same update and keeps only the marker."""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import update

from crosstune.models import List, Recording, RecordingLink, RecordingLoop, Tune, UserTune
from crosstune.sync.tables import TOMBSTONE_TEXT, TOMBSTONE_URL
from tests.helpers import T0, T1, T2, change, pull, push, recording, uid

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

COLUMNS_CLEARED_TO_NULL = (
    "genre",
    "tune_type",
    "part_structure",
    "composer",
    "key",
    "lyrics",
    "time_signature",
)
PAGE = "https://www.slippery-hill.com/recording/42"
RECORDING_CONTENT = {
    "notes": "Learned at the porch session",
    "players": "Tommy Jarrell",
    "place_name": "Galax, VA",
    "place_lat": 36.6612,
    "place_lon": -80.9240,
    "place_accuracy_m": 12,
}


async def seed_tune(client, headers) -> dict[str, str]:
    """Push a tune with every content column set, plus one child of each kind."""
    ids = {name: uid() for name in ("tune", "user_tune", "link", "own", "imported", "loop")}
    await push(
        client,
        headers,
        change(
            "tunes",
            ids["tune"],
            T0,
            title="Sally Goodin",
            alternate_titles=["Sally Goodwin"],
            genre="old_time",
            tune_type="reel",
            composer="Trad.",
            lyrics="Some words",
            key="A",
            tunings={"violin": {"tuning": "AEAE"}, "guitar": {"tuning": "DADGAD", "capo": 2}},
            part_structure="AABB",
            modes=["dorian"],
            time_signature="4/4",
        ),
        change(
            "user_tunes",
            ids["user_tune"],
            T0,
            tune_id=ids["tune"],
            status="known",
            learned_from="Grandpa",
            notes="Watch the bowing",
        ),
        change(
            "recording_links",
            ids["link"],
            T0,
            tune_id=ids["tune"],
            url="https://example.com/watch?v=1",
            provider="other",
            provider_ref="abc123",
            title="A video",
            artwork_url="https://example.com/a.jpg",
        ),
        recording(ids["own"], tune_id=ids["tune"], label="Recording one", **RECORDING_CONTENT),
        recording(
            ids["imported"],
            tune_id=ids["tune"],
            source="import",
            origin="slippery_hill",
            origin_url=PAGE,
            label="From the site",
        ),
    )
    await push(
        client,
        headers,
        change(
            "recording_loops",
            ids["loop"],
            T0,
            recording_id=ids["own"],
            label="B part",
            start_ms=1000,
            end_ms=5000,
            color=2,
        ),
    )
    return ids


async def stored(session: AsyncSession, model, id_: str):
    session.expire_all()
    return await session.get(model, uuid.UUID(id_))


async def test_deleting_a_tune_clears_its_content(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    ids = await seed_tune(client, headers)
    before = await stored(verify_session, Tune, ids["tune"])
    seq_before, created_at = before.server_seq, before.created_at

    [result] = await push(client, headers, change("tunes", ids["tune"], T1, op="delete"))
    assert result["status"] == "applied"

    row = await stored(verify_session, Tune, ids["tune"])
    assert row.title == TOMBSTONE_TEXT
    assert row.alternate_titles == []
    assert row.modes == []
    assert row.tunings == {}
    for column in COLUMNS_CLEARED_TO_NULL:
        assert getattr(row, column) is None, column
    assert row.id == uuid.UUID(ids["tune"])
    assert row.created_at == created_at
    assert row.deleted_at == T1
    assert row.server_seq > seq_before


async def test_deleting_a_tune_clears_its_children(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    ids = await seed_tune(client, headers)

    await push(client, headers, change("tunes", ids["tune"], T1, op="delete"))

    user_tune = await stored(verify_session, UserTune, ids["user_tune"])
    assert (user_tune.learned_from, user_tune.notes) == (None, None)
    assert user_tune.deleted_at == T1
    link = await stored(verify_session, RecordingLink, ids["link"])
    assert link.url == TOMBSTONE_URL
    assert (link.provider_ref, link.title, link.artwork_url) == (None, None, None)
    assert link.deleted_at == T1
    own = await stored(verify_session, Recording, ids["own"])
    assert own.label is None
    for column in RECORDING_CONTENT:
        assert getattr(own, column) is None, column
    assert own.deleted_at == T1
    imported = await stored(verify_session, Recording, ids["imported"])
    assert imported.label is None
    loop = await stored(verify_session, RecordingLoop, ids["loop"])
    assert loop.label is None
    assert loop.deleted_at == T1


async def test_deleting_a_list_clears_its_name(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    list_id = uid()
    await push(client, headers, change("lists", list_id, T0, name="Friday jam"))

    await push(client, headers, change("lists", list_id, T1, op="delete"))

    row = await stored(verify_session, List, list_id)
    assert row.name == TOMBSTONE_TEXT
    assert row.deleted_at == T1


async def test_an_own_recording_keeps_a_null_origin_url(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(client, headers, recording(rec, label="Recording one", **RECORDING_CONTENT))

    await push(client, headers, change("recordings", rec, T1, op="delete"))

    row = await stored(verify_session, Recording, rec)
    assert row.origin == "own"
    assert row.origin_url is None
    assert row.label is None
    for column in RECORDING_CONTENT:
        assert getattr(row, column) is None, column


async def test_an_imported_recording_gets_the_placeholder_origin_url(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(
        client,
        headers,
        recording(rec, source="import", origin="slippery_hill", origin_url=PAGE),
    )
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(error="fetch failed")
    )
    await verify_session.commit()

    await push(client, headers, change("recordings", rec, T1, op="delete"))

    row = await stored(verify_session, Recording, rec)
    assert row.origin == "slippery_hill"
    assert row.origin_url == TOMBSTONE_URL
    assert row.error is None


async def test_a_scrubbed_row_pulls_and_validates(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    ids = await seed_tune(client, headers)
    await push(client, headers, change("tunes", ids["tune"], T1, op="delete"))

    body = await pull(client, headers)

    rows = {r["row"]["id"]: r for r in body["rows"]}
    tune = rows[ids["tune"]]["row"]
    assert (tune["title"], tune["alternate_titles"], tune["tunings"]) == (TOMBSTONE_TEXT, [], {})
    assert tune["genre"] is None
    assert tune["deleted_at"] is not None
    assert rows[ids["link"]]["row"]["url"] == TOMBSTONE_URL
    assert rows[ids["imported"]]["row"]["origin_url"] == TOMBSTONE_URL
    assert rows[ids["own"]]["row"]["origin_url"] is None
    for column in RECORDING_CONTENT:
        assert rows[ids["own"]]["row"][column] is None, column
    assert rows[ids["user_tune"]]["row"]["notes"] is None
    assert rows[ids["loop"]]["row"]["label"] is None


async def test_a_newer_upsert_after_a_delete_writes_only_what_it_sends(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    ids = await seed_tune(client, headers)
    await push(client, headers, change("tunes", ids["tune"], T1, op="delete"))

    [result] = await push(client, headers, change("tunes", ids["tune"], T2, title="Silver Spear"))
    assert result["status"] == "applied"

    row = await stored(verify_session, Tune, ids["tune"])
    assert row.title == "Silver Spear"
    assert row.deleted_at is None
    assert row.alternate_titles == []
    assert row.modes == []
    assert row.tunings == {}
    for column in COLUMNS_CLEARED_TO_NULL:
        assert getattr(row, column) is None, column


async def test_a_revived_import_takes_its_origin_url_from_the_device(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    imported = {"source": "import", "origin": "slippery_hill", "origin_url": PAGE}
    await push(client, headers, recording(rec, **imported))
    await push(client, headers, change("recordings", rec, T1, op="delete"))
    assert (await stored(verify_session, Recording, rec)).origin_url == TOMBSTONE_URL

    [result] = await push(client, headers, recording(rec, T2, label="Back", **imported))

    assert result["status"] == "applied"
    row = await stored(verify_session, Recording, rec)
    assert row.deleted_at is None
    assert row.origin_url == PAGE
    assert row.label == "Back"


async def test_a_live_import_keeps_its_origin_url_whatever_the_device_sends(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    rec = uid()
    await push(
        client,
        headers,
        recording(rec, source="import", origin="slippery_hill", origin_url=PAGE),
    )

    await push(
        client,
        headers,
        recording(
            rec,
            T1,
            source="import",
            origin="slippery_hill",
            origin_url="https://www.slippery-hill.com/recording/7",
        ),
    )

    assert (await stored(verify_session, Recording, rec)).origin_url == PAGE


async def test_a_loop_tombstoned_by_a_trim_keeps_its_label(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    headers = auth_headers("user_a")
    rec, loop_id = uid(), uid()
    await push(client, headers, recording(rec))
    await push(
        client,
        headers,
        change(
            "recording_loops",
            loop_id,
            T0,
            recording_id=rec,
            label="B part",
            start_ms=60200,
            end_ms=70000,
            color=2,
        ),
    )

    await push(client, headers, recording(rec, T1, trim_start_ms=1000, trim_end_ms=60000))

    row = await stored(verify_session, RecordingLoop, loop_id)
    assert row.deleted_at is not None
    assert row.label == "B part"
