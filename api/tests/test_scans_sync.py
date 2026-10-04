"""Scans sync as children of a tune, and the server owns their file columns."""

from __future__ import annotations

import pytest
from sqlalchemy import select, update

from crosstune.models import Scan
from crosstune.vocabulary import MAX_SCANS_PER_TUNE
from tests.helpers import T0, T1, T2, change, pull, push, uid

pytestmark = pytest.mark.anyio


def scan(id_: str, tune: str, at=T0, **data) -> dict:
    fields = {"tune_id": tune, "position": 0, "width": 1200, "height": 1600}
    fields.update(data)
    return change("scans", id_, at, **fields)


def tune_change(id_: str, at=T0, **kw) -> dict:
    return change("tunes", id_, at, title="X", **kw)


async def test_push_creates_scan_pending_upload(client, auth_headers) -> None:
    tune, scan_id = uid(), uid()
    results = await push(client, auth_headers("user_a"), tune_change(tune), scan(scan_id, tune))
    assert [r["status"] for r in results] == ["applied", "applied"]
    body = await pull(client, auth_headers("user_a"))
    [row] = [r["row"] for r in body["rows"] if r["table"] == "scans"]
    assert row["id"] == scan_id
    assert row["tune_id"] == tune
    assert (row["width"], row["height"]) == (1200, 1600)
    assert row["state"] == "pending_upload"
    assert row["file_bytes"] is None
    assert "file_key" not in row


async def test_push_cannot_write_server_columns(client, auth_headers, verify_session) -> None:
    tune, scan_id = uid(), uid()
    await push(client, auth_headers("user_a"), tune_change(tune))
    [result] = await push(
        client, auth_headers("user_a"), scan(scan_id, tune, state="ready", file_bytes=1)
    )
    assert result["status"] == "invalid"
    assert "invalid fields" in result["reason"]
    assert await verify_session.scalar(select(Scan).where(Scan.id == scan_id)) is None


async def test_push_keeps_server_columns(client, auth_headers, verify_session) -> None:
    tune, scan_id = uid(), uid()
    await push(client, auth_headers("user_a"), tune_change(tune), scan(scan_id, tune))
    await verify_session.execute(
        update(Scan).where(Scan.id == scan_id).values(state="ready", file_key="k", file_bytes=99)
    )
    await verify_session.commit()
    await push(client, auth_headers("user_a"), scan(scan_id, tune, T1, position=3))
    verify_session.expire_all()
    stored = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    assert (stored.position, stored.state, stored.file_key, stored.file_bytes) == (
        3,
        "ready",
        "k",
        99,
    )


async def test_push_refuses_scan_on_another_users_tune(client, auth_headers) -> None:
    tune = uid()
    await push(client, auth_headers("user_b"), tune_change(tune))
    [result] = await push(client, auth_headers("user_a"), scan(uid(), tune))
    assert result["status"] == "invalid"


async def test_tune_delete_tombstones_scans(client, auth_headers, verify_session) -> None:
    tune, scan_id = uid(), uid()
    await push(client, auth_headers("user_a"), tune_change(tune), scan(scan_id, tune))
    before = await verify_session.scalar(select(Scan.server_seq).where(Scan.id == scan_id))
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, op="delete"))
    verify_session.expire_all()
    stored = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    assert stored.deleted_at is not None
    assert stored.server_seq > before


async def test_twenty_first_live_scan_is_refused(client, auth_headers) -> None:
    tune = uid()
    await push(client, auth_headers("user_a"), tune_change(tune))
    ids = [uid() for _ in range(MAX_SCANS_PER_TUNE)]
    for index, id_ in enumerate(ids):
        [result] = await push(client, auth_headers("user_a"), scan(id_, tune, position=index))
        assert result["status"] == "applied"
    [refused] = await push(client, auth_headers("user_a"), scan(uid(), tune))
    assert refused["status"] == "invalid"
    assert refused["reason"] == "scan limit reached"
    await push(client, auth_headers("user_a"), change("scans", ids[0], T1, op="delete"))
    [result] = await push(client, auth_headers("user_a"), scan(uid(), tune, T2))
    assert result["status"] == "applied"


async def test_tune_id_is_fixed(client, auth_headers) -> None:
    first, second, scan_id = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        tune_change(first),
        tune_change(second),
        scan(scan_id, first),
    )
    [result] = await push(client, auth_headers("user_a"), scan(scan_id, second, T1))
    assert result["status"] == "invalid"
    assert result["reason"] == "tune_id is fixed"


async def test_deleting_a_scan_wakes_the_runner(client, auth_headers, fake_runner) -> None:
    tune, scan_id = uid(), uid()
    await push(client, auth_headers("user_a"), tune_change(tune), scan(scan_id, tune))
    assert fake_runner.wakes == 0
    await push(client, auth_headers("user_a"), change("scans", scan_id, T1, op="delete"))
    assert fake_runner.wakes == 1


async def _fill_tune(client, auth_headers) -> tuple[str, list[str]]:
    tune = uid()
    await push(client, auth_headers("user_a"), tune_change(tune))
    ids = [uid() for _ in range(MAX_SCANS_PER_TUNE)]
    await push(
        client,
        auth_headers("user_a"),
        *(scan(id_, tune, position=index) for index, id_ in enumerate(ids)),
    )
    return tune, ids


async def test_a_full_tune_takes_an_edit_to_one_of_its_live_scans(client, auth_headers) -> None:
    tune, ids = await _fill_tune(client, auth_headers)
    [result] = await push(client, auth_headers("user_a"), scan(ids[0], tune, T1, position=99))
    assert result["status"] == "applied"
    assert result["row"]["position"] == 99


async def test_a_full_tune_ignores_a_stale_write_to_a_tombstoned_scan(
    client, auth_headers, verify_session
) -> None:
    tune, ids = await _fill_tune(client, auth_headers)
    await push(client, auth_headers("user_a"), change("scans", ids[0], T1, op="delete"))
    await push(client, auth_headers("user_a"), scan(uid(), tune, T1))
    [result] = await push(client, auth_headers("user_a"), scan(ids[0], tune, T0, position=5))
    assert result["status"] == "stale"
    stored = await verify_session.scalar(select(Scan).where(Scan.id == ids[0]))
    assert stored.deleted_at is not None
    assert stored.position == 0


async def test_a_stale_write_cannot_move_a_scan_to_another_tune(client, auth_headers) -> None:
    first, second, scan_id = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        tune_change(first),
        tune_change(second),
        scan(scan_id, first, T1),
    )
    [result] = await push(client, auth_headers("user_a"), scan(scan_id, second, T0))
    assert result["status"] == "invalid"
    assert result["reason"] == "tune_id is fixed"
