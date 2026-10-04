"""The events pull serves every history table on its own cursor."""

from __future__ import annotations

import pytest

from tests.helpers import T0, T1, change, push, recording, uid

pytestmark = pytest.mark.anyio


async def events(client, headers, since: int = 0) -> dict:
    response = await client.get(f"/v1/sync/events?since={since}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def play(recording_id: str) -> dict:
    return change(
        "play_events",
        uid(),
        T0,
        recording_id=recording_id,
        context="row",
        started_at=T0.isoformat(),
        listened_ms=30_000,
    )


def scan_view(tune_id: str) -> dict:
    return change(
        "scan_views",
        uid(),
        T1,
        tune_id=tune_id,
        context="tune",
        started_at=T1.isoformat(),
        viewed_ms=8_000,
    )


def practice(recording_id: str) -> dict:
    return change(
        "practice_sessions",
        uid(),
        T1,
        recording_id=recording_id,
        started_at=T1.isoformat(),
        duration_ms=60_000,
        speed_percent=75,
        pitch_cents=0,
    )


async def _seed_all(client, headers) -> str:
    tune_id, recording_id = uid(), uid()
    await push(
        client,
        headers,
        change("tunes", tune_id, T0, title="Angeline the Baker"),
        change("user_tunes", uid(), T0, tune_id=tune_id, status="learning"),
        recording(recording_id),
    )
    await push(client, headers, play(recording_id), practice(recording_id), scan_view(tune_id))
    return recording_id


async def test_events_pull_returns_every_history_table_in_seq_order(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    await _seed_all(client, headers)
    body = await events(client, headers)
    assert {r["table"] for r in body["rows"]} == {
        "status_changes",
        "play_events",
        "practice_sessions",
        "scan_views",
    }
    seqs = [r["row"]["server_seq"] for r in body["rows"]]
    assert seqs == sorted(seqs)
    assert body["next_since"] == seqs[-1]
    assert body["has_more"] is False
    status = next(r["row"] for r in body["rows"] if r["table"] == "status_changes")
    assert (status["from_status"], status["to_status"]) == (None, "learning")


async def test_events_pull_pages(client, app, auth_headers) -> None:
    app.state.settings.pull_page_size = 2
    headers = auth_headers("user_a")
    await _seed_all(client, headers)
    first = await events(client, headers)
    assert len(first["rows"]) == 2
    assert first["has_more"] is True
    second = await events(client, headers, since=first["next_since"])
    assert len(second["rows"]) == 2
    assert second["has_more"] is False
    assert second["rows"][0]["row"]["server_seq"] > first["next_since"]
    app.state.settings.pull_page_size = 100
    everything = await events(client, headers)
    paged = [(r["table"], r["row"]["id"]) for r in first["rows"] + second["rows"]]
    assert len(paged) == len(set(paged))
    assert set(paged) == {(r["table"], r["row"]["id"]) for r in everything["rows"]}


async def test_events_pull_is_owned(client, auth_headers) -> None:
    await _seed_all(client, auth_headers("user_a"))
    assert (await events(client, auth_headers("user_b")))["rows"] == []


async def test_events_pull_empty_keeps_cursor(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    await _seed_all(client, headers)
    last = (await events(client, headers))["next_since"]
    body = await events(client, headers, since=last)
    assert body == {"rows": [], "next_since": last, "has_more": False}


async def test_main_pull_leaves_events_out(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    await _seed_all(client, headers)
    response = await client.get("/v1/sync/pull", headers=headers)
    tables = {r["table"] for r in response.json()["rows"]}
    assert tables.isdisjoint({"status_changes", "play_events", "practice_sessions", "scan_views"})
