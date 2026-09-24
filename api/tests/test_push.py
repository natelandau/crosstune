"""Push semantics: last-write-wins, isolation of invalid changes, ownership, cascade."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import event

from crosstune.models import ListItem, RecordingLink, Tune, UserTune

if TYPE_CHECKING:
    import httpx2
    from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.anyio

T0 = datetime(2026, 9, 11, 12, 0, tzinfo=UTC)
T1 = T0 + timedelta(seconds=10)
T2 = T0 + timedelta(seconds=20)


def uid() -> str:
    return str(uuid.uuid4())


def change(table: str, id_: str, updated_at: datetime, op: str = "upsert", **data) -> dict:
    body = {"table": table, "op": op, "id": id_, "updated_at": updated_at.isoformat()}
    if op == "upsert":
        body["data"] = {"created_at": updated_at.isoformat(), **data}
    return body


async def push(client: httpx2.AsyncClient, headers: dict, *changes: dict) -> list[dict]:
    response = await client.post(
        "/v1/sync/push?names=tunes", json={"changes": list(changes)}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()["results"]


async def test_an_old_client_type_edit_reaches_the_new_column(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    headers = auth_headers("user_a")
    await push(client, headers, change("tunes", tune_id, T0, title="Swallowtail", tune_type="Reel"))
    results = await push(
        client,
        headers,
        change("tunes", tune_id, T1, title="Swallowtail", feel="Jig", tune_type="Reel"),
    )
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["tune_type"] == "Jig"
    assert results[0]["row"]["feel"] == "Jig"
    stored = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert (stored.tune_type, stored.feel) == ("Jig", "Jig")


async def test_a_new_client_push_fills_the_old_columns(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", uid(), T0, title="Out on the Ocean", tune_type="Jig", modes=["major"]),
    )
    assert results[0]["row"]["feel"] == "Jig"
    assert results[0]["row"]["mode"] == "major"
    assert results[0]["row"]["modes"] == ["major"]


async def test_batch_creates_tune_user_tune_and_link(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id, us_id, link_id = uid(), uid(), uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Angeline the Baker", key="D"),
        change("user_tunes", us_id, T0, tune_id=tune_id, status="known"),
        change(
            "recording_links",
            link_id,
            T0,
            tune_id=tune_id,
            url="https://example.com/x",
            provider="other",
            title="x",
        ),
    )
    assert [r["status"] for r in results] == ["applied", "applied", "applied"]
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune is not None
    assert tune.title == "Angeline the Baker"
    assert tune.server_seq >= 1
    assert results[0]["row"]["server_seq"] == tune.server_seq


async def test_owner_comes_from_token_not_body(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", uid(), T0, title="Sally Ann", owner_user_id=uid()),
    )
    assert results[0]["status"] == "invalid"


async def test_older_write_is_stale_and_returns_current_row(client, auth_headers) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T1, title="Newer"))
    results = await push(
        client, auth_headers("user_a"), change("tunes", tune_id, T0, title="Older")
    )
    assert results[0]["status"] == "stale"
    assert results[0]["row"]["title"] == "Newer"


async def test_newer_write_is_applied(client, auth_headers, verify_session: AsyncSession) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T0, title="First"))
    results = await push(
        client, auth_headers("user_a"), change("tunes", tune_id, T1, title="Second")
    )
    assert results[0]["status"] == "applied"
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune.title == "Second"


async def test_replay_is_a_no_op(client, auth_headers, verify_session: AsyncSession) -> None:
    tune_id = uid()
    c = change("tunes", tune_id, T0, title="Once")
    await push(client, auth_headers("user_a"), c)
    seq_before = (await verify_session.get(Tune, uuid.UUID(tune_id))).server_seq
    results = await push(client, auth_headers("user_a"), c)
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    seq_after = (await verify_session.get(Tune, uuid.UUID(tune_id))).server_seq
    assert seq_after == seq_before


async def test_invalid_change_does_not_reject_the_batch(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", uid(), T0, title="Good"),
        change("tunes", uid(), T0, title="Bad", mode="lydian"),
        change("tunes", uid(), T0, title="Also good"),
    )
    assert [r["status"] for r in results] == ["applied", "invalid", "applied"]
    assert "mode" in results[1]["reason"]


async def test_link_with_a_non_web_scheme_is_invalid(client, auth_headers) -> None:
    tune_id = uid()
    link = {"tune_id": tune_id, "provider": "other", "title": "x"}
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Soldier's Joy"),
        change("recording_links", uid(), T0, url="javascript:alert(1)", **link),
        change("recording_links", uid(), T0, url="example.com/x", **link),
    )
    assert [r["status"] for r in results] == ["applied", "invalid", "applied"]
    assert "url" in results[1]["reason"]


async def test_cannot_reference_another_users_tune(client, auth_headers) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T0, title="Mine"))
    results = await push(
        client,
        auth_headers("user_b"),
        change("user_tunes", uid(), T0, tune_id=tune_id, status="known"),
    )
    assert results[0]["status"] == "invalid"


async def test_cannot_overwrite_another_users_row_by_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T0, title="Mine"))
    results = await push(
        client, auth_headers("user_b"), change("tunes", tune_id, T2, title="Stolen")
    )
    assert results[0]["status"] == "invalid"
    assert results[0]["row"] is None
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune.title == "Mine"


async def test_cannot_overwrite_another_users_list_item_by_id(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_a, us_a, list_a, item_id = uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_a, T0, title="A's tune"),
        change("user_tunes", us_a, T0, tune_id=tune_a, status="known"),
        change("lists", list_a, T0, name="A's list"),
        change("list_items", item_id, T0, list_id=list_a, user_tune_id=us_a),
    )
    stored = await verify_session.get(ListItem, uuid.UUID(item_id))
    before = (stored.updated_at, stored.server_seq)

    tune_b, us_b, list_b = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_b"),
        change("tunes", tune_b, T0, title="B's tune"),
        change("user_tunes", us_b, T0, tune_id=tune_b, status="known"),
        change("lists", list_b, T0, name="B's list"),
    )
    results = await push(
        client,
        auth_headers("user_b"),
        change("list_items", item_id, T2, list_id=list_b, user_tune_id=us_b),
    )
    assert results[0]["status"] == "invalid"
    assert results[0]["row"] is None
    verify_session.expire_all()
    item = await verify_session.get(ListItem, uuid.UUID(item_id))
    assert item.list_id == uuid.UUID(list_a)
    assert (item.updated_at, item.server_seq) == before


async def test_duplicate_user_tune_is_invalid(client, auth_headers) -> None:
    tune_id = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Dup"),
        change("user_tunes", uid(), T0, tune_id=tune_id, status="known"),
        change("user_tunes", uid(), T0, tune_id=tune_id, status="learning"),
    )
    assert [r["status"] for r in results] == ["applied", "applied", "invalid"]


async def test_delete_tune_cascades_soft_delete(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id, us_id, link_id, list_id, item_id = uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Gone"),
        change("user_tunes", us_id, T0, tune_id=tune_id, status="known"),
        change(
            "recording_links",
            link_id,
            T0,
            tune_id=tune_id,
            url="https://example.com",
            provider="other",
            title="x",
        ),
        change("lists", list_id, T0, name="Set"),
        change("list_items", item_id, T0, list_id=list_id, user_tune_id=us_id),
    )
    dependents = (
        (Tune, tune_id),
        (UserTune, us_id),
        (RecordingLink, link_id),
        (ListItem, item_id),
    )
    seq_before = {
        id_: (await verify_session.get(model, uuid.UUID(id_))).server_seq
        for model, id_ in dependents
    }

    results = await push(client, auth_headers("user_a"), change("tunes", tune_id, T1, op="delete"))
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for model, id_ in dependents:
        row = await verify_session.get(model, uuid.UUID(id_))
        assert row.deleted_at == T1, model.__name__
        assert row.updated_at == T1, model.__name__
        assert row.server_seq > seq_before[id_], model.__name__


async def test_delete_list_cascades_to_items(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune1, tune2, us1, us2, list_id, item1, item2 = uid(), uid(), uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune1, T0, title="One"),
        change("tunes", tune2, T0, title="Two"),
        change("user_tunes", us1, T0, tune_id=tune1, status="known"),
        change("user_tunes", us2, T0, tune_id=tune2, status="known"),
        change("lists", list_id, T0, name="Set"),
        change("list_items", item1, T0, list_id=list_id, user_tune_id=us1),
        change("list_items", item2, T0, list_id=list_id, user_tune_id=us2),
    )
    seq_before = {
        id_: (await verify_session.get(ListItem, uuid.UUID(id_))).server_seq
        for id_ in (item1, item2)
    }

    results = await push(client, auth_headers("user_a"), change("lists", list_id, T1, op="delete"))
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for id_ in (item1, item2):
        item = await verify_session.get(ListItem, uuid.UUID(id_))
        assert item.deleted_at == T1
        assert item.updated_at == T1
        assert item.server_seq > seq_before[id_]


async def test_delete_user_tune_cascades_to_items(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id, us_id, list1, list2, item1, item2 = uid(), uid(), uid(), uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Tune"),
        change("user_tunes", us_id, T0, tune_id=tune_id, status="known"),
        change("lists", list1, T0, name="List 1"),
        change("lists", list2, T0, name="List 2"),
        change("list_items", item1, T0, list_id=list1, user_tune_id=us_id),
        change("list_items", item2, T0, list_id=list2, user_tune_id=us_id),
    )
    seq_before = {
        id_: (await verify_session.get(ListItem, uuid.UUID(id_))).server_seq
        for id_ in (item1, item2)
    }

    results = await push(
        client, auth_headers("user_a"), change("user_tunes", us_id, T1, op="delete")
    )
    assert results[0]["status"] == "applied"
    verify_session.expire_all()
    for id_ in (item1, item2):
        item = await verify_session.get(ListItem, uuid.UUID(id_))
        assert item.deleted_at == T1
        assert item.updated_at == T1
        assert item.server_seq > seq_before[id_]


async def test_delete_unknown_row_is_invalid(client, auth_headers) -> None:
    results = await push(client, auth_headers("user_a"), change("tunes", uid(), T0, op="delete"))
    assert results[0]["status"] == "invalid"


async def test_delete_is_idempotent(client, auth_headers) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T0, title="X"))
    first = await push(client, auth_headers("user_a"), change("tunes", tune_id, T1, op="delete"))
    second = await push(client, auth_headers("user_a"), change("tunes", tune_id, T1, op="delete"))
    assert first[0]["status"] == "applied"
    assert second[0]["status"] == "applied"


async def test_push_requires_auth(client) -> None:
    response = await client.post("/v1/sync/push", json={"changes": []})
    assert response.status_code == 401


async def test_user_settings_upsert_applies_and_a_second_row_is_invalid(
    client, auth_headers
) -> None:
    first, second = uid(), uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", first, T0, instruments=["violin", "five_string_banjo"]),
    )
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["instruments"] == ["violin", "five_string_banjo"]
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", second, T1, instruments=["five_string_banjo"]),
    )
    assert results[0]["status"] == "invalid"
    assert "constraint violation" in results[0]["reason"]


async def test_user_settings_newer_write_wins(client, auth_headers) -> None:
    settings_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings_id, T1, instruments=["violin"]),
    )
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings_id, T0, instruments=["five_string_banjo"]),
    )
    assert results[0]["status"] == "stale"
    assert results[0]["row"]["instruments"] == ["violin"]


async def test_user_settings_push_with_both_banjo_spellings_applies(client, auth_headers) -> None:
    results = await push(
        client,
        auth_headers("user_a"),
        change("user_settings", uid(), T0, instruments=["banjo", "five_string_banjo"]),
    )
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["instruments"] == ["five_string_banjo"]


async def test_user_settings_rejects_an_unknown_instrument(client, auth_headers) -> None:
    results = await push(
        client, auth_headers("user_a"), change("user_settings", uid(), T0, instruments=["kazoo"])
    )
    assert results[0]["status"] == "invalid"
    assert "instruments" in results[0]["reason"]


async def test_lyrics_round_trip_through_push_and_pull(client, auth_headers) -> None:
    tune_id = uid()
    words = "Did you ever go to meeting, Uncle Joe\n\nDon't mind the weather"
    results = await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Uncle Joe", lyrics=words),
    )
    assert results[0]["status"] == "applied"
    response = await client.get("/v1/sync/pull?since=0&names=tunes", headers=auth_headers("user_a"))
    assert response.status_code == 200, response.text
    rows = [r for r in response.json()["rows"] if r["table"] == "tunes"]
    assert rows[0]["row"]["lyrics"] == words


async def test_an_applied_upsert_reads_its_row_back_from_the_write(
    client, auth_headers, engine
) -> None:
    tune_id = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_id, T0, title="Old"))
    statements: list[str] = []

    def record(_conn, _cursor, statement: str, *_args) -> None:
        statements.append(" ".join(statement.split()).lower())

    event.listen(engine.sync_engine, "before_cursor_execute", record)
    try:
        results = await push(
            client, auth_headers("user_a"), change("tunes", tune_id, T1, title="New")
        )
    finally:
        event.remove(engine.sync_engine, "before_cursor_execute", record)
    assert results[0]["status"] == "applied"
    assert results[0]["row"]["title"] == "New"
    write = next(i for i, sql in enumerate(statements) if sql.startswith("insert into tunes"))
    assert not [sql for sql in statements[write + 1 :] if "from tunes" in sql]


async def test_a_legacy_push_keeps_other_instruments_and_the_capo(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    headers = auth_headers("user_a")
    await push(
        client,
        headers,
        change(
            "tunes",
            tune_id,
            T0,
            title="Sally Ann",
            tunings={
                "five_string_banjo": {"tuning": "Open G (gDGBD)", "capo": 2},
                "guitar": {"tuning": "DADGAD"},
            },
        ),
    )
    results = await push(
        client,
        headers,
        change(
            "tunes",
            tune_id,
            T1,
            title="Sally Ann",
            violin_tuning="Cross A (AEAE)",
            banjo_tuning="Double C (gCGCD)",
        ),
    )
    assert results[0]["status"] == "applied"
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune is not None
    assert tune.tunings == {
        "violin": {"tuning": "Cross A (AEAE)"},
        "five_string_banjo": {"tuning": "Double C (gCGCD)", "capo": 2},
        "guitar": {"tuning": "DADGAD"},
    }


async def test_a_legacy_field_overrides_the_same_instrument_in_a_sent_map(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        change(
            "tunes",
            tune_id,
            T0,
            title="Sally Ann",
            tunings={"violin": {"tuning": "Standard (GDAE)"}, "guitar": {"tuning": "DADGAD"}},
            violin_tuning=None,
        ),
    )
    assert results[0]["status"] == "applied"
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune is not None
    assert tune.tunings == {"guitar": {"tuning": "DADGAD"}}


async def test_a_legacy_create_builds_the_map(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="Sally Ann", violin_tuning="AEAE", banjo_tuning=None),
    )
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune is not None
    assert tune.tunings == {"violin": {"tuning": "AEAE"}}


async def test_a_legacy_push_never_reads_another_users_tune(
    client, auth_headers, verify_session: AsyncSession
) -> None:
    tune_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune_id, T0, title="A", tunings={"guitar": {"tuning": "DADGAD"}}),
    )
    results = await push(
        client,
        auth_headers("user_b"),
        change("tunes", tune_id, T1, title="B", violin_tuning="AEAE"),
    )
    assert results[0]["status"] == "invalid"
    tune = await verify_session.get(Tune, uuid.UUID(tune_id))
    assert tune is not None
    assert tune.tunings == {"guitar": {"tuning": "DADGAD"}}
