"""Saved places sync as their own rows, and a recording links to one by id."""

from __future__ import annotations

import pytest

from tests.helpers import T0, T1, T2, change, pull, push, recording, uid

pytestmark = pytest.mark.anyio

GALAX = {"lat": 36.6612, "lon": -80.924}


def place(id_: str, at=T0, **data) -> dict:
    fields = {"name": "Porch", **GALAX}
    fields.update(data)
    return change("places", id_, at, **fields)


def spot(**data) -> dict:
    """Recording fields for a take at the Galax point."""
    return {"place_lat": GALAX["lat"], "place_lon": GALAX["lon"], **data}


async def recording_row(client, headers, rec: str) -> dict:
    body = await pull(client, headers)
    [row] = [r["row"] for r in body["rows"] if r["table"] == "recordings" and r["row"]["id"] == rec]
    return row


async def test_push_and_pull_a_saved_place(client, auth_headers) -> None:
    pid = uid()
    [result] = await push(
        client,
        auth_headers("user_a"),
        place(pid, address="1 Main St", apple_place_id="I63802885C9A9C3F0"),
    )
    assert result["status"] == "applied"
    body = await pull(client, auth_headers("user_a"))
    [row] = [r["row"] for r in body["rows"] if r["table"] == "places"]
    assert row["id"] == pid
    assert (row["name"], row["lat"], row["lon"]) == ("Porch", GALAX["lat"], GALAX["lon"])
    assert (row["address"], row["apple_place_id"]) == ("1 Main St", "I63802885C9A9C3F0")
    assert row["deleted_at"] is None
    # Another account never sees it.
    other = await pull(client, auth_headers("user_b"))
    assert [r for r in other["rows"] if r["table"] == "places"] == []


async def test_place_name_is_trimmed_and_required(client, auth_headers) -> None:
    pid = uid()
    [result] = await push(client, auth_headers("user_a"), place(pid, name="  Porch  "))
    assert result["row"]["name"] == "Porch"
    for bad in ("", "   "):
        [result] = await push(client, auth_headers("user_a"), place(uid(), name=bad))
        assert result["status"] == "invalid"
        assert result["reason"].startswith("invalid fields: name")
    [result] = await push(
        client, auth_headers("user_a"), change("places", uid(), T0, lat=1.0, lon=1.0)
    )
    assert result["status"] == "invalid"


async def test_recording_push_links_to_a_live_place(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    assert result["status"] == "applied"
    assert result["row"]["place_id"] == pid
    assert result["row"]["place_origin"] == "picked"


async def test_recording_push_with_a_deleted_place_stores_null_place_id(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(client, auth_headers("user_a"), change("places", pid, T1, op="delete"))
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T2, place_id=pid, place_origin="picked", **spot()),
    )
    assert result["status"] == "applied"
    assert result["row"]["place_id"] is None
    assert result["row"]["place_origin"] == "picked"


async def test_recording_push_with_another_users_place_stores_null_place_id(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_b"), place(pid))
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    assert result["status"] == "applied"
    assert result["row"]["place_id"] is None


async def test_recording_push_with_new_coordinates_and_a_stale_place_id_unlinks(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T1, place_id=pid, place_origin="picked", place_lat=40.0, place_lon=-75.0),
    )
    assert result["status"] == "applied"
    assert result["row"]["place_id"] is None
    assert result["row"]["place_lat"] == 40.0


async def test_recording_push_with_the_same_coordinates_keeps_the_link(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T1, label="Renamed", place_id=pid, place_origin="picked", **spot()),
    )
    assert result["row"]["place_id"] == pid


async def test_place_origin_must_be_a_known_value(client, auth_headers) -> None:
    [result] = await push(
        client, auth_headers("user_a"), recording(uid(), place_origin="gps", **spot())
    )
    assert result["status"] == "invalid"
    assert result["reason"].startswith("invalid fields: place_origin")


async def test_place_origin_needs_coordinates(client, auth_headers) -> None:
    [result] = await push(client, auth_headers("user_a"), recording(uid(), place_origin="picked"))
    assert result["status"] == "invalid"
    assert result["reason"].startswith("invalid fields: place_origin")


async def test_a_push_that_omits_the_link_fields_keeps_the_stored_link(
    client, auth_headers
) -> None:
    """A 1.0.0 client never sends place_id or place_origin, and its edits must not unlink."""
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    [result] = await push(
        client, auth_headers("user_a"), recording(rec, T1, label="Edited", **spot())
    )
    assert result["status"] == "applied"
    assert result["row"]["label"] == "Edited"
    assert result["row"]["place_id"] == pid
    assert result["row"]["place_origin"] == "picked"


async def test_an_old_client_move_of_a_linked_take_unlinks_it(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T1, place_lat=40.0, place_lon=-75.0, place_accuracy_m=9),
    )
    assert result["row"]["place_id"] is None
    assert result["row"]["place_origin"] == "device"


async def test_a_new_take_without_an_origin_gets_one_from_its_accuracy(
    client, auth_headers
) -> None:
    device, picked = uid(), uid()
    [result] = await push(
        client, auth_headers("user_a"), recording(device, **spot(place_accuracy_m=12))
    )
    assert result["row"]["place_origin"] == "device"
    [result] = await push(client, auth_headers("user_a"), recording(picked, **spot()))
    assert result["row"]["place_origin"] == "picked"


async def test_an_edit_without_an_origin_keeps_the_stored_origin_at_the_same_point(
    client, auth_headers
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec, place_origin="file", **spot()))
    [result] = await push(client, auth_headers("user_a"), recording(rec, T1, label="x", **spot()))
    assert result["row"]["place_origin"] == "file"
    [result] = await push(
        client,
        auth_headers("user_a"),
        recording(rec, T2, place_lat=1.0, place_lon=1.0),
    )
    assert result["row"]["place_origin"] == "picked"


async def test_clearing_the_coordinates_clears_the_origin_and_link(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    await push(client, auth_headers("user_a"), place(pid))
    await push(
        client,
        auth_headers("user_a"),
        recording(rec, place_id=pid, place_origin="picked", **spot()),
    )
    [result] = await push(client, auth_headers("user_a"), recording(rec, T1))
    assert result["row"]["place_lat"] is None
    assert result["row"]["place_origin"] is None
    assert result["row"]["place_id"] is None


async def test_deleting_a_place_leaves_no_coordinates_behind(client, auth_headers) -> None:
    pid = uid()
    await push(client, auth_headers("user_a"), place(pid, address="1 Main St"))
    [result] = await push(client, auth_headers("user_a"), change("places", pid, T1, op="delete"))
    row = result["row"]
    assert row["deleted_at"] is not None
    assert (row["address"], row["apple_place_id"]) == (None, None)
    assert (row["lat"], row["lon"]) == (0.0, 0.0)


M_LAT = 1 / 111_195


def take(rec: str, at=T0, *, north_m: float = 0, **data) -> dict:
    """A device take north of the Galax point by some meters."""
    fields = {
        "place_lat": GALAX["lat"] + north_m * M_LAT,
        "place_lon": GALAX["lon"],
        "place_accuracy_m": 10,
    }
    fields.update(data)
    return recording(rec, at, **fields)


async def test_new_place_links_earlier_takes_within_30_m(client, auth_headers) -> None:
    near, far, pid = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(near, north_m=20), take(far, north_m=40))
    await push(client, headers, place(pid, T1))
    assert (await recording_row(client, headers, near))["place_id"] == pid
    assert (await recording_row(client, headers, far))["place_id"] is None


async def test_new_place_links_earlier_file_takes_and_skips_loose_ones(
    client, auth_headers
) -> None:
    filed, loose, pid = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(
        client,
        headers,
        take(filed, place_accuracy_m=None, place_origin="file"),
        take(loose, place_accuracy_m=80),
    )
    await push(client, headers, place(pid, T1))
    assert (await recording_row(client, headers, filed))["place_id"] == pid
    assert (await recording_row(client, headers, loose))["place_id"] is None


async def test_new_place_skips_picked_takes(client, auth_headers) -> None:
    picked, pid = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(picked, place_accuracy_m=None, place_origin="picked"))
    await push(client, headers, place(pid, T1))
    assert (await recording_row(client, headers, picked))["place_id"] is None


async def test_new_place_skips_takes_inside_two_places(client, auth_headers) -> None:
    rec, first, second, third = uid(), uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(first, name="One", lat=GALAX["lat"] + 20 * M_LAT))
    await push(client, headers, place(second, name="Two", lat=GALAX["lat"] - 20 * M_LAT))
    # Inside two places the push matches neither, so the take starts unlinked.
    await push(client, headers, take(rec))
    assert (await recording_row(client, headers, rec))["place_id"] is None
    await push(client, headers, place(third, T1, name="Three", lat=GALAX["lat"] + 5 * M_LAT))
    assert (await recording_row(client, headers, rec))["place_id"] is None


async def test_new_place_skips_other_accounts_and_deleted_takes(client, auth_headers) -> None:
    mine, theirs, pid = uid(), uid(), uid()
    await push(client, auth_headers("user_b"), take(theirs))
    await push(client, auth_headers("user_a"), take(mine))
    await push(client, auth_headers("user_a"), change("recordings", mine, T1, op="delete"))
    await push(client, auth_headers("user_a"), place(pid, T2))
    assert (await recording_row(client, auth_headers("user_b"), theirs))["place_id"] is None
    assert (await recording_row(client, auth_headers("user_a"), mine))["place_id"] is None


async def test_moved_place_relinks(client, auth_headers) -> None:
    pid, elsewhere = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid))
    await push(client, headers, take(elsewhere, place_lat=40.0, place_lon=-75.0))
    assert (await recording_row(client, headers, elsewhere))["place_id"] is None
    await push(client, headers, place(pid, T1, lat=40.0, lon=-75.0))
    assert (await recording_row(client, headers, elsewhere))["place_id"] == pid


async def test_renamed_place_changes_nothing_but_server_seq_of_the_place(
    client, auth_headers
) -> None:
    pid, rec, other = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec), take(other, north_m=1))
    # A device take within the radius that the device unlinked, so a rematch would link it.
    await push(client, headers, take(other, T1, north_m=1, place_id=None))
    assert (await recording_row(client, headers, other))["place_id"] is None
    before = await recording_row(client, headers, rec)
    body = await pull(client, headers)
    [stored] = [r["row"] for r in body["rows"] if r["table"] == "places"]
    await push(client, headers, place(pid, T2, name="Renamed"))
    assert await recording_row(client, headers, rec) == before
    assert (await recording_row(client, headers, other))["place_id"] is None
    body = await pull(client, headers)
    [renamed] = [r["row"] for r in body["rows"] if r["table"] == "places"]
    assert renamed["name"] == "Renamed"
    assert renamed["server_seq"] > stored["server_seq"]


async def test_deleted_place_unlinks_its_recordings_and_keeps_their_names(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(
        client,
        headers,
        place(pid),
        take(rec, place_id=pid, place_name="1 Main St", place_origin="picked"),
    )
    assert (await recording_row(client, headers, rec))["place_id"] == pid
    await push(client, headers, change("places", pid, T1, op="delete"))
    row = await recording_row(client, headers, rec)
    assert row["place_id"] is None
    assert row["place_name"] == "1 Main St"
    assert (row["place_lat"], row["place_lon"]) == (GALAX["lat"], GALAX["lon"])
    assert row["place_origin"] == "picked"


async def test_unlinked_takes_are_candidates_for_another_place(client, auth_headers) -> None:
    first, second, rec = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(rec))
    await push(client, headers, place(first))
    assert (await recording_row(client, headers, rec))["place_id"] == first
    await push(client, headers, change("places", first, T1, op="delete"))
    assert (await recording_row(client, headers, rec))["place_id"] is None
    await push(client, headers, place(second, T2, name="Second"))
    assert (await recording_row(client, headers, rec))["place_id"] == second


async def test_rematch_bumps_server_seq_and_not_updated_at(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(rec))
    before = await recording_row(client, headers, rec)
    await push(client, headers, place(pid, T1))
    after = await recording_row(client, headers, rec)
    assert after["place_id"] == pid
    assert after["updated_at"] == before["updated_at"]
    assert after["server_seq"] > before["server_seq"]


async def test_replayed_push_does_not_relink_twice(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(rec, T1))
    await push(client, headers, place(pid))
    assert (await recording_row(client, headers, rec))["place_id"] == pid
    # The device unlinks the take, then the place push is delivered again.
    await push(client, headers, take(rec, T2, place_id=None))
    unlinked = await recording_row(client, headers, rec)
    assert unlinked["place_id"] is None
    await push(client, headers, place(pid))
    assert await recording_row(client, headers, rec) == unlinked


async def test_an_old_client_echo_of_the_stored_origin_with_new_coordinates_is_inferred_again(
    client, auth_headers
) -> None:
    """A 1.0.0 client keeps unknown fields from a pull and pushes them back with its edits."""
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec))
    linked = await recording_row(client, headers, rec)
    assert (linked["place_id"], linked["place_origin"]) == (pid, "device")
    # A hand pick elsewhere: new coordinates, no accuracy, and both link keys echoed.
    [result] = await push(
        client,
        headers,
        recording(rec, T1, place_lat=40.0, place_lon=-75.0, place_origin="device", place_id=pid),
    )
    assert result["row"]["place_origin"] == "picked"
    assert result["row"]["place_id"] is None
    # An echoed origin at the same point is kept.
    [result] = await push(
        client,
        headers,
        recording(rec, T2, label="x", place_lat=40.0, place_lon=-75.0, place_origin="picked"),
    )
    assert result["row"]["place_origin"] == "picked"


async def test_an_old_client_repick_at_the_same_point_reads_as_picked(client, auth_headers) -> None:
    """A 1.0.0 hand pick at the take's own point drops the accuracy and echoes the rest."""
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec, place_name="12 Main St"))
    linked = await recording_row(client, headers, rec)
    assert (linked["place_id"], linked["place_origin"]) == (pid, "device")
    [result] = await push(
        client,
        headers,
        recording(
            rec, T1, place_name="Fiddlers Hall", place_origin="device", place_id=pid, **spot()
        ),
    )
    assert result["row"]["place_origin"] == "picked"
    assert result["row"]["place_id"] is None
    assert result["row"]["place_name"] == "Fiddlers Hall"


async def test_a_label_edit_at_the_same_point_keeps_the_device_origin(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec, place_name="12 Main St"))
    [result] = await push(
        client,
        headers,
        take(rec, T1, label="Edited", place_name="12 Main St", place_origin="device", place_id=pid),
    )
    assert result["row"]["place_origin"] == "device"
    assert result["row"]["place_id"] == pid


async def test_the_same_name_without_accuracy_keeps_the_device_origin(client, auth_headers) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec, place_name="12 Main St"))
    [result] = await push(
        client,
        headers,
        recording(
            rec,
            T1,
            label="x",
            place_name="12 Main St",
            place_origin="device",
            place_id=pid,
            **spot(),
        ),
    )
    assert result["row"]["place_origin"] == "device"
    assert result["row"]["place_id"] == pid


async def test_a_search_pick_of_the_place_a_take_is_linked_to_keeps_the_link(
    client, auth_headers
) -> None:
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid), take(rec, north_m=20))
    assert (await recording_row(client, headers, rec))["place_id"] == pid
    [result] = await push(
        client,
        headers,
        recording(rec, T1, place_id=pid, place_origin="picked", **spot()),
    )
    assert result["row"]["place_id"] == pid
    assert result["row"]["place_origin"] == "picked"


async def test_a_place_id_without_coordinates_is_dropped(client, auth_headers) -> None:
    pid = uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid))
    [result] = await push(client, headers, recording(uid(), place_id=pid))
    assert result["status"] == "applied"
    assert result["row"]["place_id"] is None


async def test_a_device_take_at_a_saved_place_is_linked_on_push_without_apple_maps(
    app, client, auth_headers
) -> None:
    app.state.maps = None
    pid, rec, filed, picked, loose = uid(), uid(), uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(pid))
    results = await push(
        client,
        headers,
        take(rec, T1),
        take(filed, T1, place_accuracy_m=None, place_origin="file"),
        take(picked, T1, place_accuracy_m=None, place_origin="picked"),
        take(loose, T1, place_accuracy_m=80),
    )
    linked = {r["row"]["id"]: r["row"]["place_id"] for r in results}
    assert linked == {rec: pid, filed: pid, picked: None, loose: None}
    row = await recording_row(client, headers, rec)
    assert row["place_id"] == pid
    assert row["place_name"] is None


async def test_deleting_a_place_links_takes_it_shared_with_a_nearby_place(
    client, auth_headers
) -> None:
    first, second, rec = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(first, name="One", lat=GALAX["lat"] + 20 * M_LAT))
    await push(client, headers, place(second, name="Two", lat=GALAX["lat"] - 20 * M_LAT))
    await push(client, headers, take(rec))
    before = await recording_row(client, headers, rec)
    assert before["place_id"] is None
    await push(client, headers, change("places", first, T1, op="delete"))
    after = await recording_row(client, headers, rec)
    assert after["place_id"] == second
    assert after["server_seq"] > before["server_seq"]
    assert after["updated_at"] == before["updated_at"]


async def test_a_push_that_missed_a_server_link_keeps_it(client, auth_headers) -> None:
    """A device that has not pulled the server's link pushes null for it with its next edit."""
    pid, rec = uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, take(rec))
    await push(client, headers, place(pid))
    assert (await recording_row(client, headers, rec))["place_id"] == pid
    [result] = await push(
        client, headers, take(rec, T1, label="Edited", place_id=None, place_origin="device")
    )
    assert result["row"]["label"] == "Edited"
    assert result["row"]["place_id"] == pid


async def test_a_new_upload_without_an_origin_or_a_name_reads_as_from_the_file(
    client, auth_headers
) -> None:
    rec = uid()
    [result] = await push(client, auth_headers("user_a"), recording(rec, source="upload", **spot()))
    assert result["row"]["place_origin"] == "file"


async def test_moving_a_place_links_takes_it_shared_with_a_nearby_place(
    client, auth_headers
) -> None:
    first, second, rec = uid(), uid(), uid()
    headers = auth_headers("user_a")
    await push(client, headers, place(first, name="One", lat=GALAX["lat"] + 20 * M_LAT))
    await push(client, headers, place(second, name="Two", lat=GALAX["lat"] - 20 * M_LAT))
    await push(client, headers, take(rec))
    assert (await recording_row(client, headers, rec))["place_id"] is None
    await push(client, headers, place(first, T1, name="One", lat=40.0, lon=-75.0))
    assert (await recording_row(client, headers, rec))["place_id"] == second
