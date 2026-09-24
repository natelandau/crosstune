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
    tune_a, tune_b = uid(), uid()
    await push(client, auth_headers("user_a"), change("tunes", tune_a, T0, title="A's tune"))
    await push(client, auth_headers("user_b"), change("tunes", tune_b, T0, title="B's tune"))
    body = await pull(client, auth_headers("user_a"))
    ids = {r["row"]["id"] for r in body["rows"]}
    assert ids == {tune_a}
    assert body["has_more"] is False
    assert body["next_since"] == body["rows"][-1]["row"]["server_seq"]


async def test_pull_after_cursor_is_empty_until_a_change(client, auth_headers) -> None:
    tune = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune, T0, title="X"))
    first = await pull(client, auth_headers("user_a"))
    empty = await pull(client, auth_headers("user_a"), since=first["next_since"])
    assert empty["rows"] == []
    assert empty["next_since"] == first["next_since"]
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, title="Y"))
    changed = await pull(client, auth_headers("user_a"), since=first["next_since"])
    assert [r["row"]["title"] for r in changed["rows"]] == ["Y"]


async def test_pull_includes_tombstones(client, auth_headers) -> None:
    tune = uid()
    await push(client, auth_headers("user_a"), change("tunes", tune, T0, title="X"))
    await push(client, auth_headers("user_a"), change("tunes", tune, T1, op="delete"))
    body = await pull(client, auth_headers("user_a"))
    assert body["rows"][0]["row"]["deleted_at"] is not None


async def test_pull_spans_tables_in_sequence_order(client, auth_headers) -> None:
    tune, us, lst = uid(), uid(), uid()
    await push(
        client,
        auth_headers("user_a"),
        change("tunes", tune, T0, title="X"),
        change("lists", lst, T0, name="Set"),
        change("user_tunes", us, T0, tune_id=tune, status="known"),
    )
    body = await pull(client, auth_headers("user_a"))
    seqs = [r["row"]["server_seq"] for r in body["rows"]]
    assert seqs == sorted(seqs)
    assert {r["table"] for r in body["rows"]} == {"tunes", "lists", "user_tunes"}


async def test_pull_pages(client, app, auth_headers) -> None:
    app.state.settings.pull_page_size = 2
    await push(
        client,
        auth_headers("user_a"),
        *[change("tunes", uid(), T0, title=f"T{i}") for i in range(5)],
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


async def test_pull_carries_both_tune_shapes(client, auth_headers) -> None:
    headers = auth_headers("user_a")
    await push(
        client,
        headers,
        change(
            "tunes",
            uid(),
            T0,
            title="Cooley's",
            tune_type="Reel",
            modes=["dorian"],
            composer="Trad.",
        ),
    )
    body = await pull(client, headers)
    row = next(r["row"] for r in body["rows"] if r["table"] == "tunes")
    assert (row["tune_type"], row["modes"], row["composer"]) == ("Reel", ["dorian"], "Trad.")
    assert (row["feel"], row["mode"]) == ("Reel", "dorian")


async def test_pull_requires_auth(client) -> None:
    response = await client.get("/v1/sync/pull?since=0")
    assert response.status_code == 401


async def test_cursor_beyond_int64_is_422(client, auth_headers) -> None:
    response = await client.get(f"/v1/sync/pull?since={2**70}", headers=auth_headers("user_a"))
    assert response.status_code == 422


async def test_pull_scopes_every_table_to_the_caller(client, auth_headers) -> None:
    async def seed(user: str) -> dict[str, set[str]]:
        tune, user_tune, lst, item, link = uid(), uid(), uid(), uid(), uid()
        await push(
            client,
            auth_headers(user),
            change("tunes", tune, T0, title=f"{user}'s tune"),
            change("user_tunes", user_tune, T0, tune_id=tune, status="known"),
            change("lists", lst, T0, name=f"{user}'s list"),
            change("list_items", item, T0, list_id=lst, user_tune_id=user_tune),
            change(
                "recording_links",
                link,
                T0,
                tune_id=tune,
                url=f"https://example.com/{user}",
                provider="other",
                title="A take",
            ),
        )
        return {
            "tunes": {tune},
            "user_tunes": {user_tune},
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


async def test_pull_includes_user_settings(client, auth_headers) -> None:
    settings_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change("user_settings", settings_id, T0, instruments=["five_string_banjo"]),
    )
    body = await pull(client, auth_headers("user_a"))
    assert [(r["table"], r["row"]["instruments"]) for r in body["rows"]] == [
        ("user_settings", ["five_string_banjo"])
    ]


async def test_pull_returns_tunings_and_the_derived_legacy_fields(client, auth_headers) -> None:
    tune_id = uid()
    await push(
        client,
        auth_headers("user_a"),
        change(
            "tunes",
            tune_id,
            T0,
            title="Sally Ann",
            tunings={"five_string_banjo": {"tuning": "Open G (gDGBD)", "capo": 2}},
        ),
    )
    body = await pull(client, auth_headers("user_a"))
    rows = [r for r in body["rows"] if r["table"] == "tunes"]
    row = rows[0]["row"]
    assert row["tunings"] == {"five_string_banjo": {"tuning": "Open G (gDGBD)", "capo": 2}}
    assert row["banjo_tuning"] == "Open G (gDGBD)"
    assert row["violin_tuning"] is None


async def test_pull_answers_in_tune_names_without_being_asked(client, auth_headers) -> None:
    await push(client, auth_headers("user_a"), change("tunes", uid(), T0, title="Sally Ann"))
    response = await client.get("/v1/sync/pull?since=0", headers=auth_headers("user_a"))
    assert response.status_code == 200, response.text
    assert {r["table"] for r in response.json()["rows"]} == {"tunes"}
