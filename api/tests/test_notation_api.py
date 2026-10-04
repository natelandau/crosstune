"""Notation page upload slots, upload confirmation, and downloads."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select, update

from crosstune.models import NotationPage, Tune, UploadSlot
from crosstune.storage.store import NOTATION_MIME, notation_key
from tests.helpers import push, uid
from tests.test_notation_sync import page, tune_change

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectInfo

pytestmark = pytest.mark.anyio

USER_A = "user_a"


async def make_page(client, auth_headers, user: str = USER_A) -> tuple[str, str]:
    tune, page_id = uid(), uid()
    await push(client, auth_headers(user), tune_change(tune), page(page_id, tune))
    return tune, page_id


async def owner_id(verify_session, page_id: str):
    return await verify_session.scalar(
        select(NotationPage.user_id).where(NotationPage.id == page_id)
    )


async def slot(
    client, headers, page_id: str, bytes_: int = 1000, content_type: str = NOTATION_MIME
):
    return await client.post(
        f"/v1/notation-pages/{page_id}/upload-slot",
        json={"bytes": bytes_, "content_type": content_type},
        headers=headers,
    )


async def uploaded(client, headers, page_id: str):
    return await client.post(f"/v1/notation-pages/{page_id}/uploaded", headers=headers)


async def download(client, headers, page_id: str):
    return await client.get(f"/v1/notation-pages/{page_id}/download", headers=headers)


async def put_object(object_store, verify_session, page_id: str, size: int) -> str:
    key = notation_key(await owner_id(verify_session, page_id), page_id)
    object_store.put_bytes(key, b"x" * size, NOTATION_MIME)
    return key


async def test_slot_signs_put_to_page_key(
    client, auth_headers, object_store, verify_session
) -> None:
    _, page_id = await make_page(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), page_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert "content_type=image/jpeg" in body["url"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)
    expected = notation_key(await owner_id(verify_session, page_id), page_id)
    assert object_store.presigned[-1] == ("put", expected)


async def test_slot_refuses_png(client, auth_headers) -> None:
    _, page_id = await make_page(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), page_id, content_type="image/png")
    assert response.status_code == 422


async def test_slot_refuses_over_5_mb(client, auth_headers) -> None:
    _, page_id = await make_page(client, auth_headers)
    response = await slot(client, auth_headers(USER_A), page_id, bytes_=5_242_881)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"
    assert (await slot(client, auth_headers(USER_A), page_id, bytes_=5_242_880)).status_code == 200


async def test_slot_refuses_over_quota(client, app, auth_headers) -> None:
    app.state.settings.storage_quota_bytes = 1500
    _, first = await make_page(client, auth_headers)
    _, second = await make_page(client, auth_headers)
    assert (await slot(client, auth_headers(USER_A), first, bytes_=1000)).status_code == 200
    response = await slot(client, auth_headers(USER_A), second, bytes_=600)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert (await slot(client, auth_headers(USER_A), second, bytes_=500)).status_code == 200


async def test_slot_can_be_reissued(client, auth_headers, verify_session) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=100)
    await slot(client, auth_headers(USER_A), page_id, bytes_=200)
    rows = (
        await verify_session.scalars(
            select(UploadSlot).where(UploadSlot.notation_page_id == page_id)
        )
    ).all()
    assert [r.declared_bytes for r in rows] == [200]


async def test_slot_reissue_near_quota_replaces_its_own_reservation(client, app, auth_headers):
    app.state.settings.storage_quota_bytes = 1000
    _, page_id = await make_page(client, auth_headers)
    assert (await slot(client, auth_headers(USER_A), page_id, bytes_=900)).status_code == 200
    assert (await slot(client, auth_headers(USER_A), page_id, bytes_=1000)).status_code == 200
    response = await slot(client, auth_headers(USER_A), page_id, bytes_=1001)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"


async def test_slot_refuses_ready_page(client, auth_headers, verify_session) -> None:
    _, page_id = await make_page(client, auth_headers)
    await verify_session.execute(
        update(NotationPage).where(NotationPage.id == page_id).values(state="ready", file_bytes=5)
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), page_id)).status_code == 409


async def test_slot_refuses_page_on_deleted_tune_or_tombstoned_page(
    client, auth_headers, verify_session
) -> None:
    tune, page_id = await make_page(client, auth_headers)
    await verify_session.execute(
        update(Tune).where(Tune.id == tune).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), page_id)).status_code == 404

    _, other = await make_page(client, auth_headers)
    await verify_session.execute(
        update(NotationPage).where(NotationPage.id == other).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers(USER_A), other)).status_code == 404


async def test_uploaded_marks_ready(client, auth_headers, object_store, verify_session) -> None:
    _, page_id = await make_page(client, auth_headers)
    before = await verify_session.scalar(select(NotationPage).where(NotationPage.id == page_id))
    seq_before = before.server_seq
    await slot(client, auth_headers(USER_A), page_id, bytes_=1000)
    key = await put_object(object_store, verify_session, page_id, 990)
    response = await uploaded(client, auth_headers(USER_A), page_id)
    assert response.status_code == 204
    await verify_session.refresh(before)
    assert (before.state, before.file_key, before.file_bytes) == ("ready", key, 990)
    assert before.server_seq > seq_before
    assert (
        await verify_session.scalar(
            select(UploadSlot).where(UploadSlot.notation_page_id == page_id)
        )
        is None
    )


async def test_uploaded_twice_is_204(client, auth_headers, object_store, verify_session) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=1000)
    await put_object(object_store, verify_session, page_id, 1000)
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 204
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 204


async def test_uploaded_without_object_is_409(client, auth_headers) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id)
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 409


async def test_uploaded_without_slot_is_409(client, auth_headers, object_store, verify_session):
    _, page_id = await make_page(client, auth_headers)
    await put_object(object_store, verify_session, page_id, 10)
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 409


async def test_uploaded_oversize_deletes_object(
    client, auth_headers, object_store, verify_session
) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=1000)
    key = await put_object(object_store, verify_session, page_id, 1060)
    response = await uploaded(client, auth_headers(USER_A), page_id)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert await object_store.head(key) is None


async def test_uploaded_over_the_cap_deletes_object(
    client, app, auth_headers, object_store, verify_session
) -> None:
    app.state.settings.notation_max_file_bytes = 500
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=500)
    key = await put_object(object_store, verify_session, page_id, 501)
    response = await uploaded(client, auth_headers(USER_A), page_id)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"
    assert await object_store.head(key) is None


async def test_uploaded_and_download_are_404_once_page_or_tune_is_tombstoned(
    client, auth_headers, object_store, verify_session
) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=100)
    await put_object(object_store, verify_session, page_id, 100)
    await verify_session.execute(
        update(NotationPage).where(NotationPage.id == page_id).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 404
    assert (await download(client, auth_headers(USER_A), page_id)).status_code == 404

    _, other = await make_page(client, auth_headers)
    other_tune = await verify_session.scalar(
        select(NotationPage.tune_id).where(NotationPage.id == other)
    )
    await slot(client, auth_headers(USER_A), other, bytes_=100)
    await put_object(object_store, verify_session, other, 100)
    assert (await uploaded(client, auth_headers(USER_A), other)).status_code == 204
    await verify_session.execute(
        update(Tune).where(Tune.id == other_tune).values(deleted_at=datetime.now(UTC))
    )
    await verify_session.commit()
    assert (await download(client, auth_headers(USER_A), other)).status_code == 404


async def test_uploaded_is_404_when_page_is_tombstoned_while_the_bucket_is_checked(
    client, auth_headers, object_store, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    _, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=100)
    await put_object(object_store, verify_session, page_id, 100)
    head = object_store.head

    async def tombstone_then_head(key: str) -> ObjectInfo | None:
        await verify_session.execute(
            update(NotationPage)
            .where(NotationPage.id == page_id)
            .values(deleted_at=datetime.now(UTC))
        )
        await verify_session.commit()
        return await head(key)

    monkeypatch.setattr(object_store, "head", tombstone_then_head)
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 404
    row = await verify_session.scalar(select(NotationPage).where(NotationPage.id == page_id))
    assert (row.state, row.file_key) == ("pending_upload", None)


async def test_uploaded_is_404_when_tune_is_deleted_while_the_bucket_is_checked(
    client, auth_headers, object_store, verify_session, monkeypatch: pytest.MonkeyPatch
) -> None:
    tune, page_id = await make_page(client, auth_headers)
    await slot(client, auth_headers(USER_A), page_id, bytes_=100)
    await put_object(object_store, verify_session, page_id, 100)
    head = object_store.head

    async def delete_tune_then_head(key: str) -> ObjectInfo | None:
        await verify_session.execute(
            update(Tune).where(Tune.id == tune).values(deleted_at=datetime.now(UTC))
        )
        await verify_session.commit()
        return await head(key)

    monkeypatch.setattr(object_store, "head", delete_tune_then_head)
    assert (await uploaded(client, auth_headers(USER_A), page_id)).status_code == 404


async def test_download_ready_page(client, auth_headers, object_store, verify_session) -> None:
    _, page_id = await make_page(client, auth_headers)
    assert (await download(client, auth_headers(USER_A), page_id)).status_code == 409
    await slot(client, auth_headers(USER_A), page_id, bytes_=100)
    key = await put_object(object_store, verify_session, page_id, 100)
    await uploaded(client, auth_headers(USER_A), page_id)
    response = await download(client, auth_headers(USER_A), page_id)
    assert response.status_code == 200, response.text
    assert response.json()["url"].startswith(f"https://fake.r2/{key}")
    assert object_store.presigned[-1] == ("get", key)


async def test_other_users_page_is_404(client, auth_headers) -> None:
    _, page_id = await make_page(client, auth_headers)
    other = auth_headers("user_b")
    assert (await slot(client, other, page_id)).status_code == 404
    assert (await uploaded(client, other, page_id)).status_code == 404
    assert (await download(client, other, page_id)).status_code == 404
    unknown = uid()
    assert (await slot(client, other, unknown)).status_code == 404
