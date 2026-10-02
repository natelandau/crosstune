"""Practice loops sync as children of a recording."""

from __future__ import annotations

import pytest

from tests.helpers import T0, T1, T2, change, pull, push, recording, uid

pytestmark = pytest.mark.anyio


def loop(id_: str, rec: str, **data) -> dict:
    fields = {"recording_id": rec, "label": "B part", "start_ms": 1000, "end_ms": 5000, "color": 2}
    fields.update(data)
    return change("recording_loops", id_, T0, **fields)


async def test_push_creates_loop_and_pull_returns_it(client, auth_headers) -> None:
    rec, loop_id = uid(), uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(client, auth_headers("user_a"), loop(loop_id, rec))
    assert result["status"] == "applied"
    body = await pull(client, auth_headers("user_a"))
    [row] = [r["row"] for r in body["rows"] if r["table"] == "recording_loops"]
    [rec_row] = [r["row"] for r in body["rows"] if r["table"] == "recordings"]
    assert row["id"] == loop_id
    # The owner comes from the token, the same as on the recording it belongs to.
    assert row["user_id"] == rec_row["user_id"]
    assert row["label"] == "B part"
    assert row["recording_id"] == rec
    assert (row["start_ms"], row["end_ms"], row["color"]) == (1000, 5000, 2)


async def test_loop_on_another_users_recording_is_invalid(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_b"), recording(rec))
    [result] = await push(client, auth_headers("user_a"), loop(uid(), rec))
    assert result["status"] == "invalid"
    assert result["reason"] == "recording_id does not reference one of your recordings"


async def test_loop_color_out_of_range_is_invalid(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(client, auth_headers("user_a"), loop(uid(), rec, color=6))
    assert result["status"] == "invalid"
    assert result["reason"].startswith("invalid fields: color")


async def test_batch_creates_recording_and_loops(client, auth_headers) -> None:
    rec = uid()
    results = await push(
        client,
        auth_headers("user_a"),
        loop(uid(), rec),
        recording(rec, T1),
        loop(uid(), rec, start_ms=6000, end_ms=9000, color=0),
    )
    assert [r["status"] for r in results] == ["applied"] * 3


def trimmed(rec: str, at=T0, start=1000, end=61000) -> dict:
    return recording(rec, at, trim_start_ms=start, trim_end_ms=end)


async def loop_rows(client, headers, since: int = 0) -> dict[str, dict]:
    body = await pull(client, headers, since)
    return {r["row"]["id"]: r["row"] for r in body["rows"] if r["table"] == "recording_loops"}


async def test_loop_end_before_start_is_invalid(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(
        client, auth_headers("user_a"), loop(uid(), rec, start_ms=5000, end_ms=5000)
    )
    assert result["status"] == "invalid"
    assert result["reason"].startswith("invalid fields:")


async def test_push_clamps_loop_into_trim_range(client, auth_headers) -> None:
    rec, loop_id = uid(), uid()
    await push(client, auth_headers("user_a"), trimmed(rec))
    [result] = await push(
        client, auth_headers("user_a"), loop(loop_id, rec, start_ms=0, end_ms=5000)
    )
    assert result["status"] == "applied"
    assert (result["row"]["start_ms"], result["row"]["end_ms"]) == (1000, 5000)


async def test_push_stores_too_short_loop_as_deleted(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), trimmed(rec))
    [result] = await push(
        client, auth_headers("user_a"), loop(uid(), rec, start_ms=60800, end_ms=70000)
    )
    assert result["status"] == "applied"
    assert result["row"]["deleted_at"] is not None


async def test_101st_live_loop_is_invalid(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    ids = [uid() for _ in range(100)]
    results = await push(
        client,
        auth_headers("user_a"),
        *(loop(i, rec, start_ms=n * 1000, end_ms=n * 1000 + 600) for n, i in enumerate(ids)),
    )
    assert {r["status"] for r in results} == {"applied"}
    [result] = await push(client, auth_headers("user_a"), loop(uid(), rec))
    assert result["status"] == "invalid"
    assert result["reason"] == "loop limit reached"
    [again] = await push(
        client, auth_headers("user_a"), change("recording_loops", ids[0], T1, **_fields(rec))
    )
    assert again["status"] == "applied"


def _fields(rec: str) -> dict:
    return {"recording_id": rec, "label": "x", "start_ms": 0, "end_ms": 900, "color": 1}


async def test_deleted_loops_do_not_count_toward_the_cap(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    ids = [uid() for _ in range(100)]
    await push(
        client,
        auth_headers("user_a"),
        *(loop(i, rec, start_ms=n * 1000, end_ms=n * 1000 + 600) for n, i in enumerate(ids)),
    )
    await push(client, auth_headers("user_a"), change("recording_loops", ids[0], T1, op="delete"))
    [result] = await push(client, auth_headers("user_a"), loop(uid(), rec))
    assert result["status"] == "applied"


async def test_trim_push_reclamps_loops(client, auth_headers) -> None:
    rec, a, b, inside = uid(), uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await push(
        client,
        headers,
        loop(a, rec, start_ms=0, end_ms=5000),
        loop(b, rec, start_ms=59000, end_ms=70000),
        loop(inside, rec, start_ms=10000, end_ms=20000),
    )
    before = await loop_rows(client, headers)
    since = max(r["server_seq"] for r in before.values())
    await push(client, headers, trimmed(rec, T1, start=2000, end=60000))
    after = await loop_rows(client, headers, since)
    assert (after[a]["start_ms"], after[a]["end_ms"]) == (2000, 5000)
    assert (after[b]["start_ms"], after[b]["end_ms"]) == (59000, 60000)
    assert after[a]["server_seq"] > since
    assert after[b]["server_seq"] > since
    # A loop the trim leaves alone keeps its seq, so no device pulls it again.
    assert inside not in after


async def test_reclamp_never_ages_a_newer_loop(client, auth_headers) -> None:
    rec, loop_id = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await push(
        client, headers, change("recording_loops", loop_id, T2, **{**_fields(rec), "end_ms": 5000})
    )
    # A trim stamped before the loop's last edit still clamps it, but an edit older than that
    # last one must not win afterwards.
    await push(client, headers, trimmed(rec, T1, start=1000, end=61000))
    rows = await loop_rows(client, headers)
    assert rows[loop_id]["start_ms"] == 1000
    stale = change("recording_loops", loop_id, T2 - (T2 - T1) / 2, **_fields(rec))
    [result] = await push(client, headers, stale)
    assert result["status"] == "stale"


async def test_moving_a_live_loop_onto_a_full_recording_is_invalid(client, auth_headers) -> None:
    full, other, mover = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(full), recording(other))
    await push(
        client,
        headers,
        *(loop(uid(), full, start_ms=n * 1000, end_ms=n * 1000 + 600) for n in range(100)),
    )
    await push(client, headers, loop(mover, other))
    [result] = await push(client, headers, change("recording_loops", mover, T1, **_fields(full)))
    assert result["status"] == "invalid"
    assert result["reason"] == "loop limit reached"


async def test_stale_move_onto_a_full_recording_is_stale_not_invalid(client, auth_headers) -> None:
    full, other, mover = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(full), recording(other))
    await push(
        client,
        headers,
        *(loop(uid(), full, start_ms=n * 1000, end_ms=n * 1000 + 600) for n in range(100)),
    )
    await push(client, headers, change("recording_loops", mover, T2, **_fields(other)))
    [result] = await push(client, headers, change("recording_loops", mover, T1, **_fields(full)))
    assert result["status"] == "stale"


async def test_trim_push_tombstones_loop_left_outside(client, auth_headers) -> None:
    rec, loop_id = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await push(client, headers, loop(loop_id, rec, start_ms=60200, end_ms=70000))
    await push(client, headers, trimmed(rec, T1, start=1000, end=60000))
    rows = await loop_rows(client, headers)
    assert rows[loop_id]["deleted_at"] is not None


async def test_delete_recording_tombstones_its_loops(client, auth_headers) -> None:
    rec, other, mine = uid(), uid(), uid()
    await push(client, auth_headers("user_a"), recording(rec), recording(other))
    await push(client, auth_headers("user_a"), loop(mine, rec), loop(uid(), other))
    b_rec, b_loop = uid(), uid()
    await push(client, auth_headers("user_b"), recording(b_rec))
    await push(client, auth_headers("user_b"), loop(b_loop, b_rec))
    await push(client, auth_headers("user_a"), change("recordings", rec, T1, op="delete"))
    rows = await loop_rows(client, auth_headers("user_a"))
    assert rows[mine]["deleted_at"] is not None
    assert [r["deleted_at"] is None for i, r in rows.items() if i != mine] == [True]
    theirs = await loop_rows(client, auth_headers("user_b"))
    assert theirs[b_loop]["deleted_at"] is None


async def test_loop_on_a_recording_with_no_known_end_is_kept_whole(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    [result] = await push(
        client, auth_headers("user_a"), loop(uid(), rec, start_ms=0, end_ms=9_000_000)
    )
    assert result["status"] == "applied"
    assert (result["row"]["start_ms"], result["row"]["end_ms"]) == (0, 9_000_000)


async def test_delete_tune_tombstones_its_recordings_loops(client, auth_headers) -> None:
    tune, rec, loop_id = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, change("tunes", tune, T0, title="Sally Goodin"))
    await push(client, headers, recording(rec, tune_id=tune))
    await push(client, headers, loop(loop_id, rec))
    await push(client, headers, change("tunes", tune, T1, op="delete"))
    rows = await loop_rows(client, headers)
    assert rows[loop_id]["deleted_at"] is not None


async def _fill_to_cap(client, headers, rec: str, first: str) -> None:
    """Leave `rec` with 100 live loops and `first` deleted at T1."""
    others = [uid() for _ in range(99)]
    await push(
        client,
        headers,
        loop(first, rec),
        *(loop(i, rec, start_ms=n * 1000, end_ms=n * 1000 + 600) for n, i in enumerate(others)),
    )
    await push(client, headers, change("recording_loops", first, T1, op="delete"))
    [last] = await push(client, headers, loop(uid(), rec))
    assert last["status"] == "applied"


async def test_stale_restore_at_the_cap_is_stale_not_invalid(client, auth_headers) -> None:
    rec, first = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await _fill_to_cap(client, headers, rec, first)
    [result] = await push(client, headers, loop(first, rec))
    assert result["status"] == "stale"
    assert result["row"]["deleted_at"] is not None


async def test_newer_restore_at_the_cap_is_invalid(client, auth_headers) -> None:
    rec, first = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await _fill_to_cap(client, headers, rec, first)
    [result] = await push(client, headers, change("recording_loops", first, T2, **_fields(rec)))
    assert result["status"] == "invalid"
    assert result["reason"] == "loop limit reached"


async def test_loop_for_a_deleted_recording_is_stored_deleted(client, auth_headers) -> None:
    rec, loop_id = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, recording(rec))
    await push(client, headers, change("recordings", rec, T1, op="delete"))
    [result] = await push(client, headers, loop(loop_id, rec))
    assert result["status"] == "applied"
    assert result["row"]["deleted_at"] is not None
