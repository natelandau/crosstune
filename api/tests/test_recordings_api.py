"""Upload slots, upload completion, retries, downloads, and the storage figures on /v1/me."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import select, update

from crosstune.models import Job, Recording, UploadSlot
from tests.test_push import T1, change, push, uid
from tests.test_recordings_sync import recording

if TYPE_CHECKING:
    from crosstune.storage.store import ObjectInfo

pytestmark = pytest.mark.anyio


async def slot(client, headers, rec: str, bytes_: int = 1000, content_type: str = "audio/mp4"):
    return await client.post(
        f"/v1/recordings/{rec}/upload-slot",
        json={"bytes": bytes_, "content_type": content_type},
        headers=headers,
    )


async def test_slot_returns_a_presigned_put(client, auth_headers, object_store) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    response = await slot(client, auth_headers("user_a"), rec)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["url"].startswith("https://fake.r2/")
    assert "content_type=audio/mp4" in body["url"]
    assert datetime.fromisoformat(body["expires_at"]) > datetime.now(UTC)
    assert object_store.presigned[-1][1].endswith(f"/{rec}/upload")


async def test_slot_needs_an_owned_pending_recording(client, auth_headers) -> None:
    rec = uid()
    assert (await slot(client, auth_headers("user_a"), rec)).status_code == 404
    await push(client, auth_headers("user_b"), recording(rec))
    assert (await slot(client, auth_headers("user_a"), rec)).status_code == 404


async def test_slot_refuses_a_file_over_the_cap(client, app, auth_headers) -> None:
    app.state.settings.recording_max_file_bytes = 500
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    response = await slot(client, auth_headers("user_a"), rec, bytes_=501)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"


async def test_slot_refuses_when_quota_would_be_exceeded(
    client, app, auth_headers, verify_session
) -> None:
    app.state.settings.recording_quota_bytes = 1500
    first, second = uid(), uid()
    await push(client, auth_headers("user_a"), recording(first), recording(second))
    await verify_session.execute(
        update(Recording).where(Recording.id == first).values(state="ready", playback_bytes=1000)
    )
    await verify_session.commit()
    response = await slot(client, auth_headers("user_a"), second, bytes_=600)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert (await slot(client, auth_headers("user_a"), second, bytes_=500)).status_code == 200


async def test_open_slots_count_toward_quota_until_they_expire(
    client, app, auth_headers, verify_session
) -> None:
    app.state.settings.recording_quota_bytes = 1000
    first, second = uid(), uid()
    await push(client, auth_headers("user_a"), recording(first), recording(second))
    assert (await slot(client, auth_headers("user_a"), first, bytes_=800)).status_code == 200
    assert (await slot(client, auth_headers("user_a"), second, bytes_=300)).status_code == 413
    await verify_session.execute(
        update(UploadSlot)
        .where(UploadSlot.recording_id == first)
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await verify_session.commit()
    assert (await slot(client, auth_headers("user_a"), second, bytes_=300)).status_code == 200


async def test_slot_can_be_reissued_and_replaces_the_declared_size(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=100)
    await slot(client, auth_headers("user_a"), rec, bytes_=200)
    stored = await verify_session.scalar(select(UploadSlot).where(UploadSlot.recording_id == rec))
    assert stored.declared_bytes == 200


async def test_slot_rejects_a_non_audio_content_type(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    response = await slot(client, auth_headers("user_a"), rec, content_type="video/mp4")
    assert response.status_code == 422
    # What a browser's MediaRecorder declares, and what the signature must cover.
    accepted = await slot(
        client, auth_headers("user_a"), rec, content_type="audio/webm;codecs=opus"
    )
    assert accepted.status_code == 200, accepted.text
    assert "content_type=audio/webm;codecs=opus" in accepted.json()["url"]


async def test_slot_returns_a_failed_recording_to_pending_upload(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="failed", error="boom")
    )
    await verify_session.commit()
    before = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    seq_before = before.server_seq
    assert (await slot(client, auth_headers("user_a"), rec)).status_code == 200
    await verify_session.refresh(before)
    assert (before.state, before.error) == ("pending_upload", None)
    assert before.server_seq > seq_before


async def test_slot_for_a_failed_recording_stops_counting_its_old_upload(
    client, app, auth_headers, verify_session
) -> None:
    app.state.settings.recording_quota_bytes = 1000
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="failed", error="boom", playback_bytes=800)
    )
    await verify_session.commit()
    # The new PUT overwrites the failed upload's object, so its 800 bytes must not
    # count alongside the 800 declared for the replacement.
    assert (await slot(client, auth_headers("user_a"), rec, bytes_=800)).status_code == 200
    me = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert me.json()["storage"]["used_bytes"] == 800
    # An abandoned slot leaves the old object in the bucket, so it counts again.
    await verify_session.execute(
        update(UploadSlot)
        .where(UploadSlot.recording_id == rec)
        .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
    )
    await verify_session.commit()
    me = await client.get("/v1/me", headers=auth_headers("user_a"))
    assert me.json()["storage"]["used_bytes"] == 800
    assert (await slot(client, auth_headers("user_a"), rec, bytes_=900)).status_code == 200
    assert (await slot(client, auth_headers("user_a"), rec, bytes_=1001)).status_code == 413


async def test_slot_conflicts_when_the_recording_is_past_upload(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(update(Recording).where(Recording.id == rec).values(state="ready"))
    await verify_session.commit()
    assert (await slot(client, auth_headers("user_a"), rec)).status_code == 409


async def test_slot_is_unavailable_without_a_store(client, app, auth_headers) -> None:
    app.state.object_store = None
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    assert (await slot(client, auth_headers("user_a"), rec)).status_code == 503


async def test_a_soft_deleted_recordings_slot_no_longer_counts_toward_quota(
    client, app, auth_headers
) -> None:
    app.state.settings.recording_quota_bytes = 1000
    first, second = uid(), uid()
    await push(client, auth_headers("user_a"), recording(first), recording(second))
    assert (await slot(client, auth_headers("user_a"), first, bytes_=1000)).status_code == 200
    await push(client, auth_headers("user_a"), change("recordings", first, T1, op="delete"))
    assert (await slot(client, auth_headers("user_a"), second, bytes_=1000)).status_code == 200


async def uploaded(client, headers, rec: str):
    return await client.post(f"/v1/recordings/{rec}/uploaded", headers=headers)


async def test_uploaded_moves_to_uploaded_and_queues_a_job(
    client, auth_headers, object_store, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=3)
    key = object_store.presigned[-1][1]
    object_store.put_bytes(key, b"abc", "audio/mp4")
    before = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    seq_before, updated_before = before.server_seq, before.updated_at
    response = await uploaded(client, auth_headers("user_a"), rec)
    assert response.status_code == 204, response.text
    await verify_session.refresh(before)
    assert before.state == "uploaded"
    assert before.playback_bytes == 3
    assert before.server_seq > seq_before
    assert before.updated_at == updated_before
    assert (
        await verify_session.scalar(select(UploadSlot).where(UploadSlot.recording_id == rec))
        is None
    )
    job = await verify_session.scalar(select(Job).where(Job.recording_id == rec))
    assert job is not None


async def test_uploaded_twice_stays_confirmed_and_queues_one_job(
    client, auth_headers, object_store, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=3)
    object_store.put_bytes(object_store.presigned[-1][1], b"abc", "audio/mp4")
    assert (await uploaded(client, auth_headers("user_a"), rec)).status_code == 204
    assert (await uploaded(client, auth_headers("user_a"), rec)).status_code == 204
    jobs = (await verify_session.scalars(select(Job).where(Job.recording_id == rec))).all()
    assert len(jobs) == 1
    stored = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    assert stored.state == "uploaded"


async def test_uploaded_conflicts_for_a_failed_recording(
    client, auth_headers, object_store, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=3)
    object_store.put_bytes(object_store.presigned[-1][1], b"abc", "audio/mp4")
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="failed")
    )
    await verify_session.commit()
    assert (await uploaded(client, auth_headers("user_a"), rec)).status_code == 409


async def test_uploaded_fails_when_nothing_was_put(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=3)
    response = await uploaded(client, auth_headers("user_a"), rec)
    assert response.status_code == 409
    stored = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    assert stored.state == "pending_upload"


async def test_uploaded_deletes_an_object_over_the_declared_size(
    client, auth_headers, object_store
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await slot(client, auth_headers("user_a"), rec, bytes_=100)
    key = object_store.presigned[-1][1]
    object_store.put_bytes(key, b"x" * 200, "audio/mp4")
    response = await uploaded(client, auth_headers("user_a"), rec)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:quota-exceeded"
    assert await object_store.head(key) is None


async def test_uploaded_deletes_an_object_over_the_file_cap(
    client, app, auth_headers, object_store
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    # Declared well above the object size, under the file cap set below, so only the
    # cap check fires and not the declared-size tolerance check.
    await slot(client, auth_headers("user_a"), rec, bytes_=1000)
    app.state.settings.recording_max_file_bytes = 10
    key = object_store.presigned[-1][1]
    object_store.put_bytes(key, b"x" * 11, "audio/mp4")
    response = await uploaded(client, auth_headers("user_a"), rec)
    assert response.status_code == 413
    assert response.json()["type"] == "urn:crosstune:file-too-large"
    assert await object_store.head(key) is None


async def test_uploaded_needs_an_open_slot(client, auth_headers) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    assert (await uploaded(client, auth_headers("user_a"), rec)).status_code == 409


async def test_download_returns_a_presigned_get_for_a_ready_recording(
    client, auth_headers, verify_session
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    response = await client.get(f"/v1/recordings/{rec}/download", headers=auth_headers("user_a"))
    assert response.status_code == 409
    await verify_session.execute(
        update(Recording)
        .where(Recording.id == rec)
        .values(state="ready", playback_key=f"u/{rec}/playback.m4a", playback_bytes=1)
    )
    await verify_session.commit()
    response = await client.get(f"/v1/recordings/{rec}/download", headers=auth_headers("user_a"))
    assert response.status_code == 200
    assert response.json()["url"] == f"https://fake.r2/u/{rec}/playback.m4a?get&expires=3600"
    other = await client.get(f"/v1/recordings/{rec}/download", headers=auth_headers("user_b"))
    assert other.status_code == 404


async def test_retry_requeues_a_failed_recording(client, auth_headers, verify_session) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    assert (
        await client.post(f"/v1/recordings/{rec}/retry", headers=auth_headers("user_a"))
    ).status_code == 409
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="failed", error="boom")
    )
    await verify_session.commit()
    before = await verify_session.scalar(select(Recording).where(Recording.id == rec))
    seq_before, updated_before = before.server_seq, before.updated_at
    response = await client.post(f"/v1/recordings/{rec}/retry", headers=auth_headers("user_a"))
    assert response.status_code == 204
    await verify_session.refresh(before)
    assert (before.state, before.error) == ("uploaded", None)
    assert before.server_seq > seq_before
    assert before.updated_at == updated_before
    assert await verify_session.scalar(select(Job).where(Job.recording_id == rec)) is not None


async def test_uploaded_for_other_user_makes_no_r2_call(
    client, auth_headers, object_store, monkeypatch
) -> None:
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    head_calls: list[str] = []

    async def spy_head(key: str) -> ObjectInfo | None:
        head_calls.append(key)
        return await object_store.head(key)

    monkeypatch.setattr(object_store, "head", spy_head)
    response = await uploaded(client, auth_headers("user_b"), rec)
    assert response.status_code == 404
    assert len(head_calls) == 0


async def test_me_reports_storage(client, app, auth_headers, verify_session) -> None:
    app.state.settings.recording_quota_bytes = 5000
    rec = uid()
    await push(client, auth_headers("user_a"), recording(rec))
    await verify_session.execute(
        update(Recording).where(Recording.id == rec).values(state="ready", playback_bytes=1200)
    )
    await verify_session.commit()
    body = (await client.get("/v1/me", headers=auth_headers("user_a"))).json()
    assert body["storage"] == {"used_bytes": 1200, "quota_bytes": 5000, "max_file_bytes": 52428800}
