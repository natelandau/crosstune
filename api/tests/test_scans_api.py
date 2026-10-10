"""Scan upload slots, upload confirmation, and downloads."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select, update

from crosstune.models import Scan, Tune, UploadSlot
from crosstune.storage.store import SCAN_MIME, legacy_scan_key, scan_key
from tests.helpers import push, uid
from tests.test_scans_sync import scan, tune_change

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectInfo

pytestmark = pytest.mark.anyio

USER_A = "user_a"


async def make_scan(client, auth_headers, user: str = USER_A) -> tuple[str, str]:
    tune, scan_id = uid(), uid()
    await push(client, auth_headers(user), tune_change(tune), scan(scan_id, tune))
    return tune, scan_id


async def owner_id(verify_session, scan_id: str):
    return await verify_session.scalar(select(Scan.user_id).where(Scan.id == scan_id))


async def slot(client, headers, scan_id: str, bytes_: int = 1000, content_type: str = SCAN_MIME):
    return await client.post(
        f"/v1/scans/{scan_id}/upload-slot",
        json={"bytes": bytes_, "content_type": content_type},
        headers=headers,
    )


async def uploaded(client, headers, scan_id: str):
    return await client.post(f"/v1/scans/{scan_id}/uploaded", headers=headers)


async def download(client, headers, scan_id: str):
    return await client.get(f"/v1/scans/{scan_id}/download", headers=headers)


async def put_object(object_store, verify_session, scan_id: str, size: int) -> str:
    key = scan_key(await owner_id(verify_session, scan_id), scan_id)
    object_store.put_bytes(key, b"x" * size, SCAN_MIME)
    return key


async def test_slot_signs_put_to_scan_key(
    client, auth_headers, object_store, verify_session
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), scan_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert "content_type=image/jpeg" in body["url"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)
    expected = scan_key(await owner_id(verify_session, scan_id), scan_id)
    assert object_store.presigned[-1] == ("put", expected)


async def test_slot_refuses_png(client, auth_headers) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), scan_id, content_type="image/png")
    assert response.status_code == 422


async def test_slot_refuses_over_5_mb(client, auth_headers) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), scan_id, bytes_=5_242_881)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"
    assert (await slot(client, auth_headers(USER_A), scan_id, bytes_=5_242_880)).status_code == 200


async def test_slot_refuses_over_quota(client, app, auth_headers) -> None:
    app.state.settings.trial_quota_bytes = 1500
    _, first = await make_scan(client, auth_headers)
    _, second = await make_scan(client, auth_headers)
    assert (await slot(client, auth_headers(USER_A), first, bytes_=1000)).status_code == 200
    response = await slot(client, auth_headers(USER_A), second, bytes_=600)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert (await slot(client, auth_headers(USER_A), second, bytes_=500)).status_code == 200


async def test_slot_can_be_reissued(client, auth_headers, verify_session) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=100)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=200)
    rows = (
        await verify_session.scalars(select(UploadSlot).where(UploadSlot.scan_id == scan_id))
    ).all()
    assert [r.declared_bytes for r in rows] == [200]


async def test_slot_reissue_near_quota_replaces_its_own_reservation(client, app, auth_headers):
    app.state.settings.trial_quota_bytes = 1000
    _, scan_id = await make_scan(client, auth_headers)
    assert (await slot(client, auth_headers(USER_A), scan_id, bytes_=900)).status_code == 200
    assert (await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)).status_code == 200
    response = await slot(client, auth_headers(USER_A), scan_id, bytes_=1001)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"


async def test_slot_refuses_ready_scan(client, auth_headers, verify_session) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await verify_session.execute(
        update(Scan).where(Scan.id == scan_id).values(state="ready", file_bytes=5)
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), scan_id)).status_code == 409


async def test_slot_refuses_scan_on_deleted_tune_or_tombstoned_scan(
    client, auth_headers, verify_session
) -> None:
    tune, scan_id = await make_scan(client, auth_headers)
    await verify_session.execute(
        update(Tune).where(Tune.id == tune).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), scan_id)).status_code == 404

    _, other = await make_scan(client, auth_headers)
    await verify_session.execute(
        update(Scan).where(Scan.id == other).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), other)).status_code == 404


async def test_uploaded_marks_ready(client, auth_headers, object_store, verify_session) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    before = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    seq_before = before.server_seq
    await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)
    key = await put_object(object_store, verify_session, scan_id, 990)
    response = await uploaded(client, auth_headers(USER_A), scan_id)
    assert response.status_code == 204
    await verify_session.refresh(before)
    assert (before.state, before.file_key, before.file_bytes) == ("ready", key, 990)
    assert before.server_seq > seq_before
    assert (
        await verify_session.scalar(select(UploadSlot).where(UploadSlot.scan_id == scan_id)) is None
    )


async def test_uploaded_deletes_an_unconfirmed_legacy_object(
    client, auth_headers, object_store, verify_session
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    legacy = legacy_scan_key(await owner_id(verify_session, scan_id), scan_id)
    object_store.put_bytes(legacy, b"x" * 10, SCAN_MIME)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)
    key = await put_object(object_store, verify_session, scan_id, 1000)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 204
    assert object_store.keys() == [key]


async def test_uploaded_succeeds_when_the_legacy_delete_fails(
    client, auth_headers, object_store, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)
    key = await put_object(object_store, verify_session, scan_id, 1000)

    async def failing_delete(*keys: str) -> None:
        raise OSError(keys)

    monkeypatch.setattr(object_store, "delete", failing_delete)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 204
    stored = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    assert (stored.state, stored.file_key) == ("ready", key)


async def test_uploaded_twice_is_204(client, auth_headers, object_store, verify_session) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)
    await put_object(object_store, verify_session, scan_id, 1000)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 204
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 204


async def test_uploaded_without_object_is_409(client, auth_headers) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 409


async def test_uploaded_without_slot_is_409(client, auth_headers, object_store, verify_session):
    _, scan_id = await make_scan(client, auth_headers)
    await put_object(object_store, verify_session, scan_id, 10)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 409


async def test_uploaded_oversize_deletes_object(
    client, auth_headers, object_store, verify_session
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=1000)
    key = await put_object(object_store, verify_session, scan_id, 1060)
    response = await uploaded(client, auth_headers(USER_A), scan_id)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert await object_store.head(key) is None


async def test_uploaded_over_the_cap_deletes_object(
    client, app, auth_headers, object_store, verify_session
) -> None:
    app.state.settings.scan_max_file_bytes = 500
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=500)
    key = await put_object(object_store, verify_session, scan_id, 501)
    response = await uploaded(client, auth_headers(USER_A), scan_id)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"
    assert await object_store.head(key) is None


async def test_uploaded_and_download_are_404_once_scan_or_tune_is_tombstoned(
    client, auth_headers, object_store, verify_session
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=100)
    await put_object(object_store, verify_session, scan_id, 100)
    await verify_session.execute(
        update(Scan).where(Scan.id == scan_id).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 404
    assert (await download(client, auth_headers(USER_A), scan_id)).status_code == 404

    _, other = await make_scan(client, auth_headers)
    other_tune = await verify_session.scalar(select(Scan.tune_id).where(Scan.id == other))
    await slot(client, auth_headers(USER_A), other, bytes_=100)
    await put_object(object_store, verify_session, other, 100)
    assert (await uploaded(client, auth_headers(USER_A), other)).status_code == 204
    await verify_session.execute(
        update(Tune).where(Tune.id == other_tune).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await download(client, auth_headers(USER_A), other)).status_code == 404


async def test_uploaded_is_404_when_scan_is_tombstoned_while_the_bucket_is_checked(
    client, auth_headers, object_store, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=100)
    await put_object(object_store, verify_session, scan_id, 100)
    head = object_store.head

    async def tombstone_then_head(key: str) -> ObjectInfo | None:
        await verify_session.execute(
            update(Scan).where(Scan.id == scan_id).values(deleted_at=datetime.now(UTC))
        )
        await verify_session.commit()
        return await head(key)

    monkeypatch.setattr(object_store, "head", tombstone_then_head)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 404
    row = await verify_session.scalar(select(Scan).where(Scan.id == scan_id))
    assert (row.state, row.file_key) == ("pending_upload", None)


async def test_uploaded_is_404_when_tune_is_deleted_while_the_bucket_is_checked(
    client, auth_headers, object_store, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tune, scan_id = await make_scan(client, auth_headers)
    await slot(client, auth_headers(USER_A), scan_id, bytes_=100)
    await put_object(object_store, verify_session, scan_id, 100)
    head = object_store.head

    async def delete_tune_then_head(key: str) -> ObjectInfo | None:
        await verify_session.execute(
            update(Tune).where(Tune.id == tune).values(deleted_at=datetime.now(UTC))
        )
        await verify_session.commit()
        return await head(key)

    monkeypatch.setattr(object_store, "head", delete_tune_then_head)
    assert (await uploaded(client, auth_headers(USER_A), scan_id)).status_code == 404


async def test_download_ready_scan(client, auth_headers, object_store, verify_session) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    assert (await download(client, auth_headers(USER_A), scan_id)).status_code == 409
    await slot(client, auth_headers(USER_A), scan_id, bytes_=100)
    key = await put_object(object_store, verify_session, scan_id, 100)
    await uploaded(client, auth_headers(USER_A), scan_id)
    response = await download(client, auth_headers(USER_A), scan_id)
    assert response.status_code == 200, response.text
    assert response.json()["url"].startswith(f"https://fake.r2/{key}")
    assert object_store.presigned[-1] == ("get", key)


async def test_other_users_scan_is_404(client, auth_headers) -> None:
    _, scan_id = await make_scan(client, auth_headers)
    other = auth_headers("user_b")
    assert (await slot(client, other, scan_id)).status_code == 404
    assert (await uploaded(client, other, scan_id)).status_code == 404
    assert (await download(client, other, scan_id)).status_code == 404
    unknown = uid()
    assert (await slot(client, other, unknown)).status_code == 404
