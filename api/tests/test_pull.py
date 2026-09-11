"""Pull returns only the caller's rows, in sequence order, with a cursor."""

from __future__ import annotations

import pytest

from tests.test_push import T0, T1, change, push, uid

pytestmark = pytest.mark.anyio


async def pull(client, headers, since: int = 0) -> dict:
    response = await client.get(f"/v1/sync/pull?since={since}", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


async def test_initial_pull_returns_everything_for_the_caller_only(client, auth_headers) -> None:
    song_a, song_b = uid(), uid()
    await push(client, auth_headers("user_a"), change("songs", song_a, T0, title="A's tune"))
    await push(client, auth_headers("user_b"), change("songs", song_b, T0, title="B's tune"))
    body = await pull(client, auth_headers("user_a"))
    ids = {r["row"]["id"] for r in body["rows"]}
    assert ids == {song_a}
    assert body["has_more"] is False
    assert body["next_since"] == body["rows"][-1]["row"]["server_seq"]


async def test_pull_after_cursor_is_empty_until_a_change(client, auth_headers) -> None:
    song = uid()
    await push(client, auth_headers("user_a"), change("songs", song, T0, title="X"))
    first = await pull(client, auth_headers("user_a"))
    empty = await pull(client, auth_headers("user_a"), since=first["next_since"])
    assert empty["rows"] == []
    assert empty["next_since"] == first["next_since"]
    await push(client, auth_headers("user_a"), change("songs", song, T1, title="Y"))
    changed = await pull(client, auth_headers("user_a"), since=first["next_since"])
    assert [r["row"]["title"] for r in changed["rows"]] == ["Y"]


async def test_pull_includes_tombstones(client, auth_headers) -> None:
    song = uid()
    await push(client, auth_headers("user_a"), change("songs", song, T0, title="X"))
    await push(client, auth_headers("user_a"), change("songs", song, T1, op="delete"))
    body = await pull(client, auth_headers("user_a"))
    assert body["rows"][0]["row"]["deleted_at"] is not None


async def test_pull_spans_tables_in_sequence_order(client, auth_headers) -> None:
    song, us, lst = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("songs", song, T0, title="X"),
        change("lists", lst, T0, name="Set"),
        change("user_songs", us, T0, song_id=song, status="known"),
    )
    body = await pull(client, auth_headers("user_a"))
    seqs = [r["row"]["server_seq"] for r in body["rows"]]
    assert seqs == sorted(seqs)
    assert {r["table"] for r in body["rows"]} == {"songs", "lists", "user_songs"}


async def test_pull_pages(client, app, auth_headers) -> None:
    app.state.settings.pull_page_size = 2
    await push(
        client,
        auth_headers("user_a"),
        *[change("songs", uid(), T0, title=f"T{i}") for i in range(5)],
    )
    seen: list[int] = []
    since = 0
    pages = 0
    while True:
        body = await pull(client, auth_headers("user_a"), since=since)
        seen += [r["row"]["server_seq"] for r in body["rows"]]
        pages += 1
        if not body["has_more"]:
            break
        since = body["next_since"]
    assert len(seen) == 5
    assert seen == sorted(seen)
    assert pages == 3


async def test_pull_requires_auth(client) -> None:
    response = await client.get("/v1/sync/pull?since=0")
    assert response.status_code == 401


async def test_cursor_beyond_int64_is_422(client, auth_headers) -> None:
    response = await client.get(f"/v1/sync/pull?since={2**70}", headers=auth_headers("user_a"))
    assert response.status_code == 422


async def test_pull_scopes_every_table_to_the_caller(client, auth_headers) -> None:
    async def seed(user: str) -> dict[str, set[str]]:
        song, user_song, lst, item, link = uid(), uid(), uid(), uid(), uid()
        await push(
            client,
            auth_headers(user),
            change("songs", song, T0, title=f"{user}'s tune"),
            change("user_songs", user_song, T0, song_id=song, status="known"),
            change("lists", lst, T0, name=f"{user}'s list"),
            change("list_items", item, T0, list_id=lst, user_song_id=user_song),
            change(
                "recording_links",
                link,
                T0,
                song_id=song,
                url=f"https://example.com/{user}",
                provider="other",
                title="A take",
            ),
        )
        return {
            "songs": {song},
            "user_songs": {user_song},
            "lists": {lst},
            "list_items": {item},
            "recording_links": {link},
        }

    seeded = {user: await seed(user) for user in ("user_a", "user_b")}

    for user, expected in seeded.items():
        body = await pull(client, auth_headers(user))
        by_table: dict[str, set[str]] = {}
        for row in body["rows"]:
            by_table.setdefault(row["table"], set()).add(row["row"]["id"])
        assert by_table == expected
